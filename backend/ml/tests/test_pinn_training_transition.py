"""Real PINN second derivatives and Adam candidates, ownership and mounted transitions."""

import asyncio
import copy
import importlib
import sys
import threading

import httpx
import pytest
import torch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pinns.model import PhysicsInformedNN, PhysicsLoss, PINNTrainer
from pinns.training_transition import PINNInputError, PINNTransitionError


def native(dtype=torch.float32, kind='poisson'):
    torch.manual_seed(41)
    return PINNTrainer(PhysicsInformedNN(2, 4, 1, 1).to(dtype), PhysicsLoss(kind), device='cpu')


def data(dtype=torch.float32):
    return torch.tensor([[.1, .2], [.3, .4]], dtype=dtype), torch.tensor([1., -1.], dtype=dtype), torch.tensor([[.2, .3], [.4, .5]], dtype=dtype)


def equal(actual, expected):
    if isinstance(expected, dict):
        assert actual.keys() == expected.keys()
        for key in expected:
            equal(actual[key], expected[key])
    elif isinstance(expected, (list, tuple)):
        assert len(actual) == len(expected)
        for a, e in zip(actual, expected):
            equal(a, e)
    elif isinstance(expected, torch.Tensor):
        torch.testing.assert_close(actual, expected, rtol=0, atol=0)
    else:
        assert actual == expected


def snapshot(t):
    return (copy.deepcopy(t.model.state_dict()), copy.deepcopy(t.optimizer.state_dict()), copy.deepcopy(t.scheduler.state_dict()),
            [None if p.grad is None else p.grad.clone() for p in t.model.parameters()], [m.training for m in t.model.modules()])


def unchanged(t, before):
    equal(snapshot(t), before)


@pytest.mark.parametrize('dtype', [torch.float32, torch.float64])
@pytest.mark.parametrize('amsgrad', [False, True])
def test_finite_native_loss_cannot_publish_infinite_actual_adam_second_moments(dtype, amsgrad):
    t = native(dtype)
    t.optimizer.param_groups[0]['amsgrad'] = amsgrad
    t.train_step(*data(dtype), f=.2)
    t.model.eval()
    t.model.input_layer.train()
    t.optimizer.param_groups[0]['weight_decay'] = 1e30 if dtype == torch.float32 else 1e200
    before = snapshot(t)
    identifiers = [id(p) for p in t.model.parameters()]
    optimizer = t.optimizer
    with pytest.raises(PINNTransitionError, match='moments'):
        t.train_step(*data(dtype), f=.2)
    unchanged(t, before)
    assert t.optimizer is optimizer and [id(p) for p in t.model.parameters()] == identifiers


@pytest.mark.parametrize('stage', ['forward', 'after-adam'])
def test_actual_failed_operation_restores_previous_gradients_modes_and_native_state(stage):
    t = native()
    t.train_step(*data(), f=.2)
    t.model.eval()
    before = snapshot(t)
    if stage == 'forward':
        def failure(*args):
            raise RuntimeError('controlled native callback failure')
        hook = t.model.register_forward_pre_hook(failure)
    else:
        def failure(optimizer, args, kwargs):
            t.scheduler.num_bad_epochs = 999
            raise RuntimeError('controlled native post-step failure')
        hook = t.optimizer.register_step_post_hook(failure)
    try:
        with pytest.raises(RuntimeError, match='controlled native'):
            t.train_step(*data(), f=.2)
    finally:
        hook.remove()
    unchanged(t, before)
    assert torch.isfinite(torch.tensor(t.train_step(*data(), f=.2)['loss']))


@pytest.mark.parametrize('kind', ['poisson', 'diffusion', 'advection', 'burger'])
def test_all_physics_native_steps_match_independent_ordinary_torch_adam(kind):
    t = native(torch.float64, kind)
    model = copy.deepcopy(t.model)
    optimizer = torch.optim.Adam(model.parameters(), lr=.001)
    x, y, points = data(torch.float64)
    points = points.clone().requires_grad_(True)
    predicted = model(x)
    field = model(points)
    first = torch.autograd.grad(field, points, torch.ones_like(field), create_graph=True)[0]
    ux, ut = first[:, :1], first[:, 1:]
    if kind in ('poisson', 'diffusion', 'burger'):
        uxx = torch.autograd.grad(ux, points, torch.ones_like(ux), create_graph=True)[0][:, :1]
    if kind == 'poisson':
        uy = first[:, 1:]
        uyy = torch.autograd.grad(uy, points, torch.ones_like(uy), create_graph=True)[0][:, 1:]
        residual = -uxx - uyy - .2
    elif kind == 'diffusion':
        residual = ut - uxx
    elif kind == 'advection':
        residual = ut + ux
    else:
        residual = ut + field * ux - .01 * uxx
    objective = (predicted - y[:, None]).square().mean() + residual.square().mean()
    optimizer.zero_grad()
    objective.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), 1., error_if_nonfinite=True)
    optimizer.step()
    result = t.train_step(*data(torch.float64), **({'f': .2} if kind == 'poisson' else {}))
    assert result['loss'] == pytest.approx(objective.item(), abs=1e-14)
    equal(t.model.state_dict(), model.state_dict())
    equal(t.optimizer.state_dict(), optimizer.state_dict())


@pytest.mark.parametrize('kind,option', [('poisson', 'f'), ('diffusion', 'D')])
def test_admitted_observations_and_physics_values_owned_before_native_hook(kind, option):
    t, reference = native(kind=kind), native(kind=kind)
    x, y, points = data()
    coefficient = torch.tensor(.2)
    expected = reference.train_step(x.clone(), y.clone(), points.clone(), **{option: coefficient.clone()})
    def mutation(*args):
        x.fill_(100)
        y.fill_(100)
        points.fill_(100)
        coefficient.fill_(100)
    hook = t.model.register_forward_pre_hook(mutation)
    try:
        actual = t.train_step(x, y, points, **{option: coefficient})
    finally:
        hook.remove()
    equal(actual, expected)
    equal(t.model.state_dict(), reference.model.state_dict())
    assert x.eq(100).all() and coefficient.item() == 100


def test_later_failed_minibatch_retains_prior_accepted_model_and_no_scheduler_epoch():
    t = native()
    accepted = []
    def first_then_failure(optimizer, args, kwargs):
        if not accepted:
            accepted.append(snapshot(t))
        else:
            raise RuntimeError('second native step failed')
    hook = t.optimizer.register_step_post_hook(first_then_failure)
    try:
        with pytest.raises(RuntimeError, match='second native'):
            t.train(*data(), epochs=1, batch_size=1, f=.2)
    finally:
        hook.remove()
    unchanged(t, accepted[0])
    assert t.scheduler.last_epoch == 0


@pytest.mark.parametrize('policy,value', [('lr', float('nan')), ('weight_decay', -1),
    ('betas', (.9, 1)), ('capturable', True), ('differentiable', True), ('eps', True)])
def test_invalid_native_optimizer_policy_does_not_enter_forward(policy, value):
    t = native()
    t.optimizer.param_groups[0][policy] = value
    calls = []
    hook = t.model.register_forward_pre_hook(lambda *args: calls.append(1))
    try:
        with pytest.raises(PINNTransitionError):
            t.train_step(*data(), f=.2)
    finally:
        hook.remove()
    assert calls == []


def test_full_native_work_policy_rejects_before_forward_or_scheduler():
    t = native()
    before = snapshot(t)
    with pytest.raises(PINNInputError, match='bounded positive'):
        t.train(*data(), epochs=1001, batch_size=1)
    unchanged(t, before)


@pytest.fixture
def mounted():
    name = 'routes.pinns_routes'
    previous = sys.modules.pop(name, None)
    route = importlib.import_module(name)
    app = FastAPI()
    app.include_router(route.router)
    yield TestClient(app), route
    sys.modules.pop(name, None)
    if previous is not None:
        sys.modules[name] = previous


def test_actual_default_native_consumer_restores_request_specific_physics(mounted):
    client, route = mounted
    before = route.physics_loss.physics_type
    response = client.post('/pinns/train', json={'epochs': 1, 'data_points': 2, 'phys_points': 2, 'batch_size': 2, 'physics_type': 'poisson'})
    assert response.status_code == 200, response.text
    assert response.json()['data']['physics_type'] == 'poisson'
    assert route.physics_loss.physics_type == before
    assert route.trainer.optimizer.state


@pytest.mark.parametrize('field,value', [('epochs', True), ('data_points', 0), ('phys_points', 10001),
    ('batch_size', '2'), ('physics_type', 'unknown'), ('epochs', 1000)])
def test_actual_mounted_bad_policy_422_before_allocation_or_live_mutation(mounted, field, value):
    client, route = mounted
    body = {'epochs': 1, 'data_points': 2, 'phys_points': 2, 'batch_size': 2}
    body[field] = value
    before = snapshot(route.trainer)
    rng = torch.get_rng_state().clone()
    response = client.post('/pinns/train', json=body)
    assert response.status_code == 422, response.text
    unchanged(route.trainer, before)
    torch.testing.assert_close(torch.get_rng_state(), rng, rtol=0, atol=0)


def test_actual_native_overflow_consumer_is_generic500_restores_physics_and_candidate(mounted):
    client, route = mounted
    route.trainer.optimizer.param_groups[0]['weight_decay'] = 1e30
    before = snapshot(route.trainer)
    response = client.post('/pinns/train', json={'epochs': 1, 'data_points': 2, 'phys_points': 2, 'batch_size': 2, 'physics_type': 'poisson'})
    assert response.status_code == 500 and response.json()['detail'] == 'Internal server error'
    unchanged(route.trainer, before)
    assert route.physics_loss.physics_type == 'diffusion'


@pytest.mark.asyncio
@pytest.mark.parametrize('cancelled', [False, True])
async def test_actual_native_worker_ownership_serializes_predict_during_training(mounted, cancelled):
    _, route = mounted
    route.trainer = native()
    entered, release = threading.Event(), threading.Event()
    calls = []
    def pause(module, args):
        calls.append(threading.get_ident())
        if len(calls) == 1:
            entered.set()
            assert release.wait(3)
    hook = route.trainer.model.register_forward_pre_hook(pause)
    watchdog = threading.Timer(2, release.set)
    watchdog.start()
    app = FastAPI()
    app.include_router(route.router)
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            first = asyncio.create_task(client.post('/pinns/train', json={'epochs': 1, 'data_points': 2, 'phys_points': 2, 'batch_size': 2, 'physics_type': 'poisson'}))
            assert await asyncio.to_thread(entered.wait, 1)
            assert not release.is_set() and calls[0] != threading.get_ident()
            if cancelled:
                first.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await first
            second = asyncio.create_task(client.post('/pinns/predict', json=[[0., 0.]]))
            await asyncio.sleep(.05)
            assert not second.done() and len(calls) == 1
            release.set()
            if not cancelled:
                assert (await asyncio.wait_for(first, 3)).status_code == 200
            assert (await asyncio.wait_for(second, 3)).status_code == 200
            assert route.trainer.physics_loss.physics_type == 'poisson'
            assert route.trainer.optimizer.state
    finally:
        release.set()
        watchdog.cancel()
        hook.remove()


def test_actual_default_toy_training_payload_is_admitted_and_completed(mounted):
    client, route = mounted
    response = client.post('/pinns/train', json={})
    assert response.status_code == 200, response.text
    assert response.json()['data']['epochs'] == 1
    assert route.trainer.scheduler.last_epoch == 1
