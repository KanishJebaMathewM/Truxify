"""Actual NeRF two-sample analytic density/color learning and observation ownership."""

import copy
import importlib
import math
import sys

import pytest
import torch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from nerf.model import NeRFNetwork, NeRFRenderer, NeRFTrainer


def native(dtype=torch.float64):
    model = NeRFNetwork(num_frequencies=0, num_dir_frequencies=0, hidden_dim=2,
                        num_layers=1, skip_layer=4).to(dtype)
    with torch.no_grad():
        for p in model.parameters():
            p.zero_()
        model.density_layers[0].weight[0, 2] = 1
        model.density_head.bias.fill_(.4)
        model.color_layers[0].weight[0, 0] = 1
        model.color_layers[2].weight.fill_(1)
    return model


def observations(dtype=torch.float64):
    return {'origins': torch.zeros(1, 3, dtype=dtype),
            'directions': torch.tensor([[0., 0., 1.]], dtype=dtype),
            'rgb': torch.full((1, 3), .3, dtype=dtype)}


def render(model, differentiable=False):
    data = observations(next(model.parameters()).dtype)
    renderer = NeRFRenderer(model, near=.1, far=1, num_samples=2, device='cpu')
    return renderer.render_rays(data['origins'][None], data['directions'][None],
                                differentiable=differentiable)


@pytest.mark.parametrize('dtype', [torch.float32, torch.float64])
def test_actual_volume_density_and_color_gradients_match_closed_form(dtype):
    model = native(dtype)
    result = render(model, True)
    rgb = result['rgb'][0, 0]
    loss = ((rgb - .3) ** 2).mean()
    loss.backward()
    c0, c1 = 1 / (1 + math.exp(-.1)), 1 / (1 + math.exp(-1))
    transmittance = math.exp(-.4 * .9)
    expected_rgb = (1 - transmittance) * c0 + transmittance * c1
    density_derivative = .9 * transmittance * (c0 - c1)
    expected_bias_grad = 2 * (expected_rgb - .3) * density_derivative
    color_weight_grad = 2 * (expected_rgb - .3) / 3 * (
        (1 - transmittance) * c0 * (1 - c0) * .1 + transmittance * c1 * (1 - c1))
    torch.testing.assert_close(rgb, torch.full_like(rgb, expected_rgb))
    torch.testing.assert_close(model.density_head.bias.grad, torch.tensor([expected_bias_grad], dtype=dtype))
    torch.testing.assert_close(model.density_head.weight.grad[0, 0], torch.tensor(.1 * expected_bias_grad, dtype=dtype))
    torch.testing.assert_close(model.color_layers[2].weight.grad,
                               torch.full_like(model.color_layers[2].weight, color_weight_grad))
    assert model.density_head.bias.grad.abs().item() > .01


def test_native_density_gradient_matches_independent_finite_difference():
    model = native()
    loss = ((render(model, True)['rgb'] - .3) ** 2).mean()
    loss.backward()
    grad = model.density_head.bias.grad.item()
    epsilon = 1e-6
    with torch.no_grad():
        model.density_head.bias.fill_(.4 + epsilon)
        positive = ((render(model)['rgb'] - .3) ** 2).mean().item()
        model.density_head.bias.fill_(.4 - epsilon)
        negative = ((render(model)['rgb'] - .3) ** 2).mean().item()
    assert grad == pytest.approx((positive - negative) / (2 * epsilon), rel=1e-7)


def test_accepted_ray_update_matches_independent_native_volume_and_adam():
    model = native()
    trainer = NeRFTrainer(model, device='cpu')
    reference = copy.deepcopy(model)
    optimizer = torch.optim.Adam(reference.parameters(), lr=5e-4)
    sigma, colors = reference(torch.tensor([[0., 0., .1], [0., 0., 1.]], dtype=torch.float64),
                              torch.tensor([[0., 0., 1.], [0., 0., 1.]], dtype=torch.float64))
    alpha0 = -torch.expm1(-sigma[0, 0].clamp_min(0) * .9)
    alpha1 = -torch.expm1(-sigma[1, 0].clamp_min(0) * 1e10)
    rgb = alpha0 * colors[0] + (1 - alpha0) * alpha1 * colors[1]
    loss = ((rgb - .3) ** 2).mean()
    loss.backward()
    optimizer.step()
    result = trainer.train_rays(observations(), epochs=1, num_samples=2, near=.1, far=1)
    assert result['objective'] == 'rendered_ray_rgb' and result['density_gradient_path'] is True
    assert result['final_loss'] == pytest.approx(loss.item())
    for actual, wanted in zip(model.parameters(), reference.parameters()):
        torch.testing.assert_close(actual, wanted, rtol=1e-10, atol=1e-12)
    for a, b in zip(trainer.optimizer.state.values(), optimizer.state.values()):
        for name in a:
            torch.testing.assert_close(a[name], b[name], rtol=1e-10, atol=1e-12)


def test_actual_training_updates_density_and_reduces_rendered_pixel_error():
    model = native()
    trainer = NeRFTrainer(model, lr=.01, device='cpu')
    old = model.density_head.bias.clone()
    before = ((render(model)['rgb'] - .3) ** 2).mean().item()
    result = trainer.train_rays(observations(), epochs=10, num_samples=2, near=.1, far=1)
    after = ((render(model)['rgb'] - .3) ** 2).mean().item()
    assert after < before and not torch.equal(old, model.density_head.bias)
    assert len(result['losses']) == 10


@pytest.mark.parametrize('differentiable', [False, True])
def test_default_inference_and_caller_grad_context_are_preserved(differentiable):
    model = native()
    result = render(model, differentiable)
    assert result['rgb'].requires_grad is differentiable
    with torch.no_grad():
        result = render(model, differentiable)
        assert not result['rgb'].requires_grad
    assert torch.is_grad_enabled()


def test_legacy_pointwise_fit_remains_explicit_and_does_not_train_density():
    model = native()
    trainer = NeRFTrainer(model, device='cpu')
    before = copy.deepcopy(model.density_head.state_dict())
    result = trainer.train({'points': torch.tensor([[0., 0., .1]], dtype=torch.float64),
                            'directions': torch.tensor([[0., 0., 1.]], dtype=torch.float64),
                            'rgb': torch.full((1, 3), .3, dtype=torch.float64)}, epochs=1, batch_size=1)
    assert result['objective'] == 'pointwise_rgb' and result['density_gradient_path'] is False
    for name, value in model.density_head.state_dict().items():
        assert torch.equal(value, before[name])
    assert all(p.grad is None for p in model.density_head.parameters())


def snapshot(t):
    return (copy.deepcopy(t.model.state_dict()), copy.deepcopy(t.optimizer.state_dict()),
            [m.training for m in t.model.modules()],
            [None if p.grad is None else p.grad.clone() for p in t.model.parameters()])


def same(a, b):
    if isinstance(a, torch.Tensor):
        torch.testing.assert_close(a, b, rtol=0, atol=0)
    elif isinstance(a, dict):
        assert a.keys() == b.keys()
        for key in a:
            same(a[key], b[key])
    elif isinstance(a, (list, tuple)):
        assert len(a) == len(b)
        for left, right in zip(a, b):
            same(left, right)
    else:
        assert a == b


@pytest.mark.parametrize('defect', ['missing', 'nan_tail', 'geometry', 'rows', 'zero_direction',
                                   'rgb_range', 'dtype', 'point_overflow'])
def test_complete_ray_admission_preserves_native_state_before_updates(defect):
    model = native()
    trainer = NeRFTrainer(model, device='cpu')
    data = {name: value.repeat(2, 1) for name, value in observations().items()}
    if defect == 'missing':
        del data['rgb']
    elif defect == 'nan_tail':
        data['rgb'][-1, 0] = float('nan')
    elif defect == 'geometry':
        data['origins'] = data['origins'][:, :2]
    elif defect == 'rows':
        data['rgb'] = data['rgb'][:1]
    elif defect == 'zero_direction':
        data['directions'][-1].zero_()
    elif defect == 'rgb_range':
        data['rgb'][-1, 0] = 1.01
    elif defect == 'dtype':
        data['rgb'] = data['rgb'].float()
    else:
        data['origins'][-1].fill_(1.7e308)
        data['directions'][-1].fill_(1e308)
    model.eval()
    for p in model.parameters():
        p.grad = torch.ones_like(p)
    before = snapshot(trainer)
    with pytest.raises(ValueError):
        trainer.train_rays(data, epochs=1, batch_size=1, num_samples=2)
    same(snapshot(trainer), before)


@pytest.mark.parametrize('options', [{'epochs': True}, {'epochs': 0}, {'batch_size': 0},
                                     {'batch_size': 4097}, {'num_samples': 1}, {'num_samples': 257},
                                     {'near': -1}, {'near': True}, {'near': 2, 'far': 1}, {'far': float('inf')}])
def test_complete_policy_precedes_model_mutation(options):
    t = NeRFTrainer(native(), device='cpu')
    before = snapshot(t)
    with pytest.raises(ValueError):
        t.train_rays(observations(), **options)
    same(snapshot(t), before)


def test_ray_observations_are_owned_before_native_callbacks():
    t, reference = NeRFTrainer(native(), device='cpu'), NeRFTrainer(native(), device='cpu')
    data = observations()
    expected = reference.train_rays(observations(), epochs=1, num_samples=2, near=.1, far=1)

    def mutation(module, args):
        for value in data.values():
            value.fill_(float('nan'))

    hook = t.model.register_forward_pre_hook(mutation)
    try:
        actual = t.train_rays(data, epochs=1, num_samples=2, near=.1, far=1)
    finally:
        hook.remove()
    assert actual == expected
    same(t.model.state_dict(), reference.model.state_dict())


@pytest.mark.parametrize('budget', ['MAX_QUERY_SAMPLES', 'MAX_SAMPLE_WORK'])
def test_work_budget_rejects_before_update(monkeypatch, budget):
    import nerf.ray_training as admission

    monkeypatch.setattr(admission, budget, 1)
    t = NeRFTrainer(native(), device='cpu')
    before = snapshot(t)
    with pytest.raises(ValueError):
        t.train_rays(observations(), epochs=1, num_samples=2)
    same(snapshot(t), before)


def test_training_does_not_silently_override_caller_no_grad():
    t = NeRFTrainer(native(), device='cpu')
    before = snapshot(t)
    with torch.no_grad(), pytest.raises(ValueError, match='autograd'):
        t.train_rays(observations())
    same(snapshot(t), before)


@pytest.fixture
def mounted():
    name = 'routes.nerf_routes'
    previous = sys.modules.pop(name, None)
    route = importlib.import_module(name)
    app = FastAPI()
    app.include_router(route.router)
    yield TestClient(app), route
    sys.modules.pop(name, None)
    if previous is not None:
        sys.modules[name] = previous


def payload():
    return {'origins': [[0, 0, 0]], 'directions': [[0, 0, 1]], 'rgb': [[.3, .3, .3]],
            'epochs': 1, 'batch_size': 1, 'num_samples': 2, 'near': .1, 'far': 1}


def test_actual_mounted_ray_consumer_uses_native_default_model_and_adam(mounted):
    client, route = mounted
    response = client.post('/nerf/train/rays', json=payload())
    assert response.status_code == 200, response.text
    result = response.json()['data']
    assert result['objective'] == 'rendered_ray_rgb' and result['density_gradient_path'] is True
    assert route.trainer.optimizer.state
    assert route.model.density_head.bias.grad is not None


@pytest.mark.parametrize('field,value', [('epochs', True), ('epochs', 0), ('num_samples', 1),
                                        ('origins', [[0, 0]]), ('directions', [[0, 0, 0]]),
                                        ('rgb', [[2, 0, 0]]), ('far', -.1)])
def test_actual_mounted_rejection_preserves_live_native_state(mounted, field, value):
    client, route = mounted
    request = payload()
    request[field] = value
    before = snapshot(route.trainer)
    response = client.post('/nerf/train/rays', json=request)
    assert response.status_code == 422, response.text
    same(snapshot(route.trainer), before)


def test_actual_native_internal_failure_is_generic_500(mounted):
    client, route = mounted

    def failure(module, args):
        raise RuntimeError('controlled native forward failure')

    hook = route.model.register_forward_pre_hook(failure)
    try:
        response = client.post('/nerf/train/rays', json=payload())
    finally:
        hook.remove()
    assert response.status_code == 500
    assert response.json()['detail'] == 'Internal server error'


def test_entire_fourier_input_range_rejected_before_earlier_ray_update():
    model = NeRFNetwork(num_frequencies=2, num_dir_frequencies=0, hidden_dim=8, num_layers=1)
    trainer = NeRFTrainer(model, device='cpu')
    data = {name: value.repeat(2, 1) for name, value in observations(torch.float32).items()}
    data['origins'][-1].fill_(1e38)
    before = snapshot(trainer)
    with pytest.raises(ValueError, match='positional encoding'):
        trainer.train_rays(data, epochs=1, batch_size=1, num_samples=2, near=.1, far=1)
    same(snapshot(trainer), before)
