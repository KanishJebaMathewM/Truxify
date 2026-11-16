"""Independent native affine adaptation, binary identity and complete consumer admission."""

import asyncio
import copy
import importlib
import sys
import threading

import httpx
import numpy as np
import pytest
import torch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from meta.fewshot_admission import FewShotInputError, FewShotTransitionError
from meta.model import MAML, FewShotLearner, MAMLModel


def native(dtype=torch.float64, lr=.03):
    model = MAMLModel(2, 4, 1, 1).to(dtype)
    model.network = torch.nn.Sequential(torch.nn.Linear(2, 1, dtype=dtype))
    with torch.no_grad():
        model.network[0].weight.copy_(torch.tensor([[.2, -.1]], dtype=dtype))
        model.network[0].bias.fill_(.3)
    return FewShotLearner(MAML(model, inner_lr=lr, device='cpu'))


def observations():
    return np.array([[1., 2.], [-1., 3.]]), np.array([.5, -.2]), np.array([[2., 1.], [0., -1.]])


def snapshot(few):
    m = few.maml
    return (copy.deepcopy(m.model.state_dict()), copy.deepcopy(m.outer_optimizer.state_dict()),
            [p.grad.clone() if p.grad is not None else None for p in m.model.parameters()],
            [module.training for module in m.model.modules()], torch.get_rng_state().clone())


def unchanged(few, before):
    weights, moments, grads, modes, rng = before
    for name, value in weights.items():
        torch.testing.assert_close(few.maml.model.state_dict()[name], value, rtol=0, atol=0)
    assert few.maml.outer_optimizer.state_dict() == moments
    for p, previous in zip(few.maml.model.parameters(), grads):
        if previous is None:
            assert p.grad is None
        else:
            torch.testing.assert_close(p.grad, previous, rtol=0, atol=0)
    assert [m.training for m in few.maml.model.modules()] == modes
    torch.testing.assert_close(torch.get_rng_state(), rng, rtol=0, atol=0)


@pytest.mark.parametrize('dtype', [torch.float32, torch.float64])
@pytest.mark.parametrize('steps', [1, 2, 32])
def test_native_adaptation_matches_independent_affine_gradient_recurrence(dtype, steps):
    few = native(dtype)
    sx, sy, query = observations()
    w, b = np.array([.2, -.1]), .3
    for _ in range(steps):
        residual = sx @ w + b - sy
        w = w - .03 * (2 / len(sx)) * (sx.T @ residual)
        b = b - .03 * (2 / len(sx)) * residual.sum()
    for p in few.maml.model.parameters():
        p.grad = torch.full_like(p, 7)
    few.maml.model.network[0].eval()
    before = snapshot(few)
    result = few.few_shot_predict(sx, sy, query, steps)
    np.testing.assert_allclose(result[:, 0], query @ w + b, rtol=2e-5, atol=2e-7)
    assert result.dtype == (np.float32 if dtype == torch.float32 else np.float64)
    unchanged(few, before)


@pytest.mark.parametrize('score,expected', [(-100, 0), (.5, 0), (.51, 1), (100, 1)])
@pytest.mark.parametrize('rows', [1, 3])
def test_binary_native_scores_never_invent_category_or_drop_query_axis(score, expected, rows):
    few = native(lr=0)
    with torch.no_grad():
        few.maml.model.network[0].weight.zero_()
        few.maml.model.network[0].bias.fill_(score)
    result = few.few_shot_classify({'1': [[0., 0.]], '0': [[1., 1.]]}, np.zeros((rows, 2)), 1)
    assert result.shape == (rows,) and result.dtype == np.int64
    np.testing.assert_array_equal(result, [expected] * rows)


@pytest.mark.parametrize('steps', [-1, 0, 33, True, 1.5, '2'])
def test_policy_rejected_before_native_forward(steps):
    few = native()
    before = snapshot(few)
    with pytest.raises(FewShotInputError):
        few.few_shot_predict(*observations(), steps)
    unchanged(few, before)


@pytest.mark.parametrize('field,value', [('x', []), ('x', [[1., 2., 3.]]), ('x', [[True, False]]),
    ('x', [[1, 2], [3]]), ('y', [float('nan'), 0]), ('y', [1]),
    ('q', [[float('inf'), 1]]), ('q', []), ('q', [[1e300, 1]])])
def test_complete_tail_observation_admission_before_any_adaptation(field, value):
    few = native(torch.float32)
    sx, sy, query = observations()
    sx, sy, query = {'x': (value, sy, query), 'y': (sx, value, query), 'q': (sx, sy, value)}[field]
    calls = []
    hook = few.maml.model.register_forward_pre_hook(lambda *args: calls.append(1))
    before = snapshot(few)
    try:
        with pytest.raises(FewShotInputError):
            few.few_shot_predict(sx, sy, query, 2)
    finally:
        hook.remove()
    assert calls == []
    unchanged(few, before)


@pytest.mark.parametrize('support_set', [{}, {'0': [[0, 0]]}, {'0': [[0, 0]], '2': [[1, 1]]},
    {'zero': [[0, 0]], 'one': [[1, 1]]}, {'0': [], '1': [[1, 1]]}])
def test_unsupported_or_incomplete_class_set_is_admission_error(support_set):
    few = native()
    before = snapshot(few)
    with pytest.raises(FewShotInputError):
        few.few_shot_classify(support_set, [[0, 0]], 1)
    unchanged(few, before)


def test_native_finite_inputs_produce_nonfinite_adaptation_candidate_without_publication():
    few = native(torch.float32, lr=1e20)
    with torch.no_grad():
        for p in few.maml.model.parameters():
            p.zero_()
    before = snapshot(few)
    with pytest.raises(FewShotTransitionError, match='adapted parameter'):
        few.few_shot_predict([[1e20, 0]], [1], [[0, 0]], 1)
    unchanged(few, before)


def test_native_nonfinite_support_objective_rejected_without_publication():
    few = native(torch.float32)
    before = snapshot(few)
    with pytest.raises(FewShotTransitionError, match='objective'):
        few.few_shot_predict([[0, 0]], [1e30], [[0, 0]], 1)
    unchanged(few, before)


def test_nonfinite_native_query_rejected_without_model_or_optimizer_mutation():
    few = native(torch.float32, lr=0)
    with torch.no_grad():
        few.maml.model.network[0].weight.fill_(1e20)
        few.maml.model.network[0].bias.zero_()
    before = snapshot(few)
    with pytest.raises(FewShotTransitionError, match='query predictions'):
        few.few_shot_predict([[0, 0]], [0], [[1e20, 0]], 1)
    unchanged(few, before)


def test_caller_arrays_owned_before_actual_native_support_hook_changes_them():
    few = native()
    sx, sy, query = observations()
    expected = few.few_shot_predict(sx.copy(), sy.copy(), query.copy(), 2)
    def mutation(*args):
        sx.fill(100)
        sy.fill(100)
        query.fill(100)
    hook = few.maml.model.register_forward_pre_hook(mutation)
    try:
        actual = few.few_shot_predict(sx, sy, query, 2)
    finally:
        hook.remove()
    np.testing.assert_array_equal(actual, expected)
    assert (query == 100).all()


def test_direct_native_adaptation_keeps_second_order_parameter_and_input_links():
    few = native()
    x = torch.tensor([[1., 2.]], dtype=torch.float64, requires_grad=True)
    adapted = few.maml.adapt(x, torch.tensor([1.], dtype=torch.float64), 2, training=False)
    objective = adapted(torch.ones(1, 2, dtype=torch.float64)).square().sum()
    gradients = torch.autograd.grad(objective, (*few.maml.model.parameters(), x), create_graph=True)
    assert all(torch.isfinite(g).all() for g in gradients)
    higher = torch.autograd.grad(sum(g.square().sum() for g in gradients), tuple(few.maml.model.parameters()))
    assert all(torch.isfinite(g).all() for g in higher)


@pytest.fixture
def mounted():
    name = 'routes.meta_routes'
    previous = sys.modules.pop(name, None)
    route = importlib.import_module(name)
    app = FastAPI()
    app.include_router(route.router)
    yield TestClient(app), route
    sys.modules.pop(name, None)
    if previous is not None:
        sys.modules[name] = previous


def test_actual_default_model_mounted_complete_regression_and_binary_output(mounted):
    client, route = mounted
    x = [[0.] * 64]
    response = client.post('/meta/few-shot/predict', json={'support_x': x, 'support_y': [0.], 'query_x': x, 'steps': 1})
    assert response.status_code == 200, response.text
    assert np.asarray(response.json()['data']['predictions']).shape == (1, 1)
    response = client.post('/meta/few-shot/classify', json={'support_set': {'0': x, '1': x}, 'query_x': x, 'steps': 1})
    assert response.status_code == 200, response.text
    assert response.json()['data']['predictions'] in ([0], [1])
    assert not route.maml.outer_optimizer.state


@pytest.mark.parametrize('field,value', [('steps', True), ('steps', -1), ('steps', 33),
    ('query_x', []), ('query_x', [[1, 2]]), ('support_x', [[True] * 64]),
    ('support_x', [[0.] * 64, [1.]]), ('support_y', [1e300])])
def test_actual_asgi_bad_observations_are_422(mounted, field, value):
    client, route = mounted
    x = [[0.] * 64]
    body = {'support_x': x, 'support_y': [0.], 'query_x': x, 'steps': 1}
    body[field] = value
    before = snapshot(route.few_shot)
    response = client.post('/meta/few-shot/predict', json=body)
    assert response.status_code == 422, response.text
    unchanged(route.few_shot, before)


def test_actual_asgi_unsupported_class_and_internal_candidate_are_distinguished(mounted):
    client, route = mounted
    x = [[0.] * 64]
    response = client.post('/meta/few-shot/classify', json={'support_set': {'0': x, '2': x}, 'query_x': x, 'steps': 1})
    assert response.status_code == 422
    route.maml.inner_lr = 1e300
    response = client.post('/meta/few-shot/predict', json={'support_x': x, 'support_y': [1.], 'query_x': x, 'steps': 1})
    assert response.status_code == 500
    assert response.json()['detail'] == 'Internal server error'


@pytest.mark.parametrize('lr', [float('nan'), float('inf'), -1., True])
def test_invalid_native_policy_is_internal_transition_failure(lr):
    few = native()
    few.maml.inner_lr = lr
    before = snapshot(few)
    with pytest.raises(FewShotTransitionError):
        few.few_shot_predict(*observations(), 1)
    unchanged(few, before)


def test_native_graph_work_budget_precedes_forward_and_private_copy():
    few = FewShotLearner(MAML(MAMLModel(2, 128, 1, 3), device='cpu'))
    calls = []
    hook = few.maml.model.register_forward_pre_hook(lambda *args: calls.append(1))
    before = snapshot(few)
    try:
        with pytest.raises(FewShotInputError, match='work budget'):
            few.few_shot_predict(np.zeros((4096, 2)), np.zeros(4096), np.zeros((1, 2)), 32)
    finally:
        hook.remove()
    assert calls == []
    unchanged(few, before)


def test_native_nonfinite_generation_not_reported_as_caller_admission():
    few = native()
    with torch.no_grad():
        few.maml.model.network[0].bias.fill_(float('nan'))
    with pytest.raises(FewShotTransitionError, match='native model state'):
        few.few_shot_predict(*observations(), 1)


@pytest.mark.asyncio
async def test_actual_fewshot_native_forward_runs_in_worker_while_loop_serves_metadata(mounted, monkeypatch):
    _, route = mounted
    few = native(torch.float32)
    monkeypatch.setattr(route, 'few_shot', few)
    entered, release = threading.Event(), threading.Event()
    threads = []
    def pause(module, args):
        threads.append(threading.get_ident())
        entered.set()
        assert release.wait(3)
    hook = few.maml.model.register_forward_pre_hook(pause)
    watchdog = threading.Timer(2, release.set)
    watchdog.start()
    app = FastAPI()
    app.include_router(route.router)
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            request = asyncio.create_task(client.post('/meta/few-shot/predict', json={
                'support_x': [[1, 2]], 'support_y': [1], 'query_x': [[1, 2]], 'steps': 1}))
            assert await asyncio.to_thread(entered.wait, 1)
            assert not release.is_set()
            assert (await client.get('/meta/model-info')).status_code == 200
            assert threads[0] != threading.get_ident()
            release.set()
            assert (await asyncio.wait_for(request, 3)).status_code == 200
    finally:
        release.set()
        watchdog.cancel()
        hook.remove()
