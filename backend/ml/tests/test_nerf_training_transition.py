"""Actual pointwise native Adam references, corrupt candidates and observation ownership."""

import copy
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
import torch
from nerf.model import NeRFNetwork, NeRFTrainer


def setup(dtype=torch.float32):
    torch.manual_seed(17)
    model = NeRFNetwork(num_frequencies=1, num_dir_frequencies=1, hidden_dim=8,
                        num_layers=2, skip_layer=1).to(dtype)
    return model, NeRFTrainer(model, device='cpu')


def data(dtype=torch.float32):
    return (torch.tensor([[.1, .2, .3], [.3, .2, .1]], dtype=dtype),
            torch.tensor([[1., 0., 0.], [0., 0., 1.]], dtype=dtype),
            torch.tensor([[.2, .4, .6], [.4, .3, .2]], dtype=dtype))


def equal(a, b):
    if isinstance(a, torch.Tensor):
        torch.testing.assert_close(a, b, rtol=0, atol=0, equal_nan=True)
    elif isinstance(a, dict):
        assert a.keys() == b.keys()
        for k in a:
            equal(a[k], b[k])
    elif isinstance(a, (tuple, list)):
        assert len(a) == len(b)
        for x, y in zip(a, b):
            equal(x, y)
    else:
        assert a == b


def snapshot(model, trainer):
    return (copy.deepcopy(model.state_dict()), copy.deepcopy(trainer.optimizer.state_dict()),
            [None if p.grad is None else p.grad.clone() for p in model.parameters()],
            [m.training for m in model.modules()])


def prior(model):
    model.eval()
    model.density_layers[0].train()
    for p in model.parameters():
        p.grad = torch.full_like(p, .003)


def manual(model, opt, tensors):
    model.train()
    opt.zero_grad()
    _, rgb = model(*tensors[:2])
    loss = torch.nn.functional.mse_loss(rgb, tensors[2])
    loss.backward()
    opt.step()
    return loss.item()


@pytest.mark.parametrize('dtype', [torch.float32, torch.float64])
def test_native_mse_weights_moments_and_corrected_retry_match_reference(dtype):
    model, trainer = setup(dtype)
    reference = copy.deepcopy(model)
    opt = torch.optim.Adam(reference.parameters(), lr=5e-4)
    for _ in range(2):
        expected = manual(reference, opt, data(dtype))
        assert trainer.train_step(*data(dtype)) == expected
        equal(model.state_dict(), reference.state_dict())
        equal(trainer.optimizer.state_dict(), opt.state_dict())
    prior(model)
    trainer.optimizer.param_groups[0]['lr'] = 1e308
    before = snapshot(model, trainer)
    ids = [id(p) for p in model.parameters()]
    with pytest.raises((ValueError, RuntimeError)):
        trainer.train_step(*data(dtype))
    equal(snapshot(model, trainer), before)
    assert ids == [id(p) for p in model.parameters()]
    trainer.optimizer.param_groups[0]['lr'] = 5e-4
    expected = manual(reference, opt, data(dtype))
    assert trainer.train_step(*data(dtype)) == expected
    equal(model.state_dict(), reference.state_dict())
    equal(trainer.optimizer.state_dict(), opt.state_dict())


@pytest.mark.parametrize('policy', [{'weight_decay': 1e30}, {'lr': 1e38}])
def test_real_native_partial_exception_and_nonfinite_moments_restore_empty_state(policy):
    model, trainer = setup()
    prior(model)
    trainer.optimizer.param_groups[0].update(policy)
    before = snapshot(model, trainer)
    with pytest.raises((RuntimeError, ValueError)):
        trainer.train_step(*data())
    equal(snapshot(model, trainer), before)
    assert not trainer.optimizer.state


@pytest.mark.parametrize('bad', ['nan', 'mismatch', 'integer', 'empty', 'rgb_range', 'fourier'])
def test_complete_late_observation_rejection_before_prior_state_or_rng_changes(bad):
    model, trainer = setup()
    prior(model)
    tensors = list(data())
    if bad == 'nan':
        tensors[0][-1, 0] = float('nan')
    elif bad == 'mismatch':
        tensors[1] = tensors[1][:1]
    elif bad == 'integer':
        tensors[0] = tensors[0].long()
    elif bad == 'empty':
        tensors = [t[:0] for t in tensors]
    elif bad == 'rgb_range':
        tensors[2][-1, 2] = 1.2
    else:
        tensors[0][-1, 0] = 3e38
    before, rng = snapshot(model, trainer), torch.get_rng_state().clone()
    with pytest.raises(ValueError):
        trainer.train({'points': tensors[0], 'directions': tensors[1], 'rgb': tensors[2]},
                      epochs=1, batch_size=1)
    equal(snapshot(model, trainer), before)
    equal(torch.get_rng_state(), rng)


@pytest.mark.parametrize('epochs,batch_size', [(0, 1), (True, 1), (101, 1), (1, 0), (1, 100001)])
def test_training_policy_rejected_before_native_effects(epochs, batch_size):
    model, trainer = setup()
    before, rng = snapshot(model, trainer), torch.get_rng_state().clone()
    points, directions, rgb = data()
    with pytest.raises(ValueError):
        trainer.train({'points': points, 'directions': directions, 'rgb': rgb}, epochs, batch_size)
    equal(snapshot(model, trainer), before)
    equal(torch.get_rng_state(), rng)


@pytest.mark.parametrize('field,value', [('lr', float('inf')), ('eps', -1.),
                                       ('weight_decay', float('nan')), ('betas', (.9, 1.))])
def test_prior_adam_policy_rejected_before_shuffling(field, value):
    model, trainer = setup()
    prior(model)
    trainer.optimizer.param_groups[0][field] = value
    before, rng = snapshot(model, trainer), torch.get_rng_state().clone()
    points, directions, rgb = data()
    with pytest.raises(ValueError):
        trainer.train({'points': points, 'directions': directions, 'rgb': rgb}, 1, 1)
    after = snapshot(model, trainer)
    equal(after[0], before[0])
    equal(after[2:], before[2:])
    equal(torch.get_rng_state(), rng)


@pytest.mark.parametrize('kind', ['raise_after', 'parameter_nan', 'moment_inf', 'gradient_nan'])
def test_native_failure_retains_earlier_accepted_batch_and_mixed_modes(kind, monkeypatch):
    model, trainer = setup()
    trainer.train_step(*data())
    prior(model)
    before = snapshot(model, trainer)
    if kind == 'gradient_nan':
        model.color_layers[2].weight.register_hook(lambda g: torch.full_like(g, float('nan')))
    else:
        native = trainer.optimizer.step

        def broken(*args, **kwargs):
            result = native(*args, **kwargs)
            if kind == 'raise_after':
                raise RuntimeError('after actual native Adam')
            if kind == 'parameter_nan':
                with torch.no_grad():
                    next(model.parameters()).fill_(float('nan'))
            else:
                next(iter(trainer.optimizer.state.values()))['exp_avg'].fill_(float('inf'))
            return result

        monkeypatch.setattr(trainer.optimizer, 'step', broken)
    with pytest.raises((RuntimeError, ValueError)):
        trainer.train_step(*data())
    equal(snapshot(model, trainer), before)


def test_caller_collection_mutation_after_admission_keeps_original_native_math(monkeypatch):
    model, trainer = setup()
    reference = copy.deepcopy(model)
    tensors, original = data(), data()
    native = model.forward

    def mutate(*args, **kwargs):
        for t in tensors:
            t.fill_(0)
        return native(*args, **kwargs)

    monkeypatch.setattr(model, 'forward', mutate)
    opt = torch.optim.Adam(reference.parameters(), lr=5e-4)
    expected = manual(reference, opt, original)
    result = trainer.train(dict(zip(('points', 'directions', 'rgb'), tensors)), 1, 2)
    assert result['final_loss'] == pytest.approx(expected)
    for key, v in model.state_dict().items():
        torch.testing.assert_close(v, reference.state_dict()[key])


def test_checkpoint_save_waits_for_complete_native_update(monkeypatch, tmp_path):
    _model, trainer = setup()
    entered, release, called = Event(), Event(), Event()
    native = trainer.optimizer.step

    def held(*args, **kwargs):
        entered.set()
        assert release.wait(10)
        return native(*args, **kwargs)

    monkeypatch.setattr(trainer.optimizer, 'step', held)

    def save():
        called.set()
        trainer.save(str(tmp_path / 'nerf.pth'))

    with ThreadPoolExecutor(max_workers=2) as pool:
        update = pool.submit(trainer.train_step, *data())
        assert entered.wait(10)
        checkpoint = pool.submit(save)
        assert called.wait(10)
        assert not checkpoint.done()
        release.set()
        assert update.result(timeout=15) > 0
        checkpoint.result(timeout=15)
    loaded = torch.load(tmp_path / 'nerf.pth', weights_only=True)
    equal(loaded['model_state_dict'], trainer.model.state_dict())
    equal(loaded['optimizer_state_dict'], trainer.optimizer.state_dict())
