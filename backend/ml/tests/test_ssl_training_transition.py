"""Native SSL optimizer/dictionary recovery, dataset ownership and real ASGI methods."""

import copy
import importlib
import sys

import pytest
import torch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from self_supervised.model import MaskedAutoencoder, MoCo, SimCLR, SSLPreTrainer

METHODS = ['simclr', 'moco', 'mae']


def native(method, mask_ratio=1):
    torch.manual_seed(7)
    model = {'simclr': lambda: SimCLR(2, 4, 2),
             'moco': lambda: MoCo(2, 4, 2, queue_size=3),
             'mae': lambda: MaskedAutoencoder(2, 4, mask_ratio)}[method]()
    return SSLPreTrainer(model, device='cpu')


def data_for(method):
    return torch.ones(2, 2, 2) if method == 'mae' else torch.ones(2, 2)


def run(t, method, data=None, epochs=1, batch_size=2):
    return getattr(t, 'pretrain_' + method)(data_for(method) if data is None else data, epochs, batch_size)


def snapshot(t):
    return (copy.deepcopy(t.model.state_dict()), copy.deepcopy(t.optimizer.state_dict()),
            [None if p.grad is None else p.grad.clone() for p in t.model.parameters()],
            [m.training for m in t.model.modules()])


def same(a, b):
    if isinstance(a, torch.Tensor):
        torch.testing.assert_close(a, b, rtol=0, atol=0, equal_nan=True)
    elif isinstance(a, dict):
        assert a.keys() == b.keys()
        for key in a:
            same(a[key], b[key])
    elif isinstance(a, (tuple, list)):
        assert len(a) == len(b)
        for left, right in zip(a, b):
            same(left, right)
    else:
        assert a == b


@pytest.mark.parametrize('method', METHODS)
def test_actual_adamw_decay_overflow_recovers_entire_native_state_and_continues(method):
    t = native(method)
    run(t, method)  # populate actual moments and a MoCo dictionary
    t.model.eval()
    t.optimizer.param_groups[0]['lr'] = 1e30
    t.optimizer.param_groups[0]['weight_decay'] = 1e30
    before = snapshot(t)
    objects = [id(t.model), id(t.optimizer)] + [id(p) for p in t.model.parameters()]
    with pytest.raises(ValueError, match='finite'):
        run(t, method)
    same(snapshot(t), before)
    assert objects == [id(t.model), id(t.optimizer)] + [id(p) for p in t.model.parameters()]
    t.optimizer.param_groups[0].update(lr=1e-4, weight_decay=.01)
    assert torch.isfinite(torch.tensor(run(t, method)['final_loss']))


@pytest.mark.parametrize('method', METHODS)
def test_native_optimizer_exception_after_real_update_recovers_dictionary_and_gradients(method):
    t = native(method)
    run(t, method)
    t.model.eval()
    before = snapshot(t)

    def after_step(optimizer, args, kwargs):
        raise RuntimeError('native post-step callback failure')

    handle = t.optimizer.register_step_post_hook(after_step)
    try:
        with pytest.raises(RuntimeError, match='post-step'):
            run(t, method)
    finally:
        handle.remove()
    same(snapshot(t), before)
    assert torch.isfinite(torch.tensor(run(t, method)['final_loss']))


@pytest.mark.parametrize('method', METHODS)
def test_accepted_update_matches_independent_native_objective_and_adamw(method):
    t = native(method)
    reference = copy.deepcopy(t.model)
    optimizer = torch.optim.AdamW(reference.parameters(), lr=1e-4)
    data = data_for(method)
    torch.manual_seed(31)
    order = torch.randperm(len(data))
    batch = data[order]
    if method == 'mae':
        _, loss, mask = reference(batch)
        assert mask.all()
    else:
        first = batch + torch.randn_like(batch) * .01
        second = batch + torch.randn_like(batch) * .01
        if method == 'moco':
            loss = reference(first, second)
        else:
            _, a = reference(first)
            _, b = reference(second)
            embeddings = torch.cat([a, b])
            logits = embeddings @ embeddings.T / reference.temperature
            logits = logits.masked_fill(torch.eye(4, dtype=torch.bool), -torch.inf)
            loss = torch.nn.functional.cross_entropy(logits, torch.tensor([2, 3, 0, 1]))
    loss.backward()
    torch.nn.utils.clip_grad_norm_(reference.parameters(), 1., error_if_nonfinite=True)
    optimizer.step()
    torch.manual_seed(31)
    actual = run(t, method)
    assert actual['final_loss'] == pytest.approx(loss.item())
    same(t.model.state_dict(), reference.state_dict())
    same(t.optimizer.state_dict(), optimizer.state_dict())


@pytest.mark.parametrize('method', METHODS)
@pytest.mark.parametrize('defect', ['nan_tail', 'empty', 'rank', 'width', 'dtype'])
def test_complete_dataset_admission_before_mode_or_native_update(method, defect):
    t = native(method)
    data = data_for(method)
    if defect == 'nan_tail':
        data[-1].fill_(float('nan'))
    elif defect == 'empty':
        data = data[:0]
    elif defect == 'rank':
        data = data.unsqueeze(1)
    elif defect == 'width':
        data = data[..., :1]
    else:
        data = data.double()
    t.model.eval()
    before = snapshot(t)
    with pytest.raises(ValueError):
        run(t, method, data, batch_size=1)
    same(snapshot(t), before)


@pytest.mark.parametrize('method', METHODS)
@pytest.mark.parametrize('epochs,batch_size', [(0, 1), (True, 1), (1.5, 1), (101, 1),
                                             (1, 0), (1, True), (1, 8193)])
def test_complete_integer_policy_before_native_state_change(method, epochs, batch_size):
    t = native(method)
    before = snapshot(t)
    with pytest.raises(ValueError):
        run(t, method, epochs=epochs, batch_size=batch_size)
    same(snapshot(t), before)


@pytest.mark.parametrize('method', METHODS)
def test_owned_dataset_survives_caller_mutation_during_forward(method):
    t, reference = native(method), native(method)
    data = data_for(method)
    torch.manual_seed(31)
    expected = run(reference, method)

    def mutate(module, args):
        data.fill_(float('nan'))

    hook = t.model.register_forward_pre_hook(mutate)
    try:
        torch.manual_seed(31)
        actual = run(t, method, data)
    finally:
        hook.remove()
    assert actual == expected
    same(t.model.state_dict(), reference.model.state_dict())
    same(t.optimizer.state_dict(), reference.optimizer.state_dict())


def test_empty_mae_observations_preserve_prior_moments_gradients_and_modes():
    t = native('mae')
    run(t, 'mae')
    t.model.mask_ratio = 0
    t.model.eval()
    before = snapshot(t)
    result = run(t, 'mae')
    assert result['final_loss'] == 0
    assert result['observed_batches'] == 0 and result['skipped_batches'] == 1
    same(snapshot(t), before)


@pytest.mark.parametrize('defect', ['variance', 'step', 'missing', 'moment_shape', 'lr', 'foreign_parameter'])
def test_incompatible_adam_state_rejected_before_new_model_changes(defect):
    t = native('simclr')
    run(t, 'simclr')
    parameter = next(iter(t.optimizer.state))
    state = t.optimizer.state[parameter]
    if defect == 'variance':
        state['exp_avg_sq'].fill_(-1)
    elif defect == 'step':
        state['step'].fill_(.5)
    elif defect == 'missing':
        del state['exp_avg']
    elif defect == 'moment_shape':
        state['exp_avg'] = torch.ones(1)
    elif defect == 'lr':
        t.optimizer.param_groups[0]['lr'] = float('nan')
    else:
        t.optimizer.param_groups[0]['params'].append(torch.nn.Parameter(torch.ones(1)))
    before = snapshot(t)
    with pytest.raises(ValueError):
        run(t, 'simclr')
    # NaN scalar policy requires its own equality check.
    after = snapshot(t)
    same(after[0], before[0])
    same(after[2:], before[2:])
    if defect != 'lr':
        same(after[1], before[1])


@pytest.mark.parametrize('budget', ['MAX_VALUES', 'MAX_WORK'])
def test_bounded_observation_work_before_optimizer_entry(monkeypatch, budget):
    import self_supervised.training_transition as transition

    monkeypatch.setattr(transition, budget, 1)
    t = native('moco')
    before = snapshot(t)
    with pytest.raises(ValueError):
        run(t, 'moco')
    same(snapshot(t), before)


@pytest.fixture
def mounted():
    name = 'routes.ssl_routes'
    previous = sys.modules.pop(name, None)
    route = importlib.import_module(name)
    app = FastAPI()
    app.include_router(route.router)
    yield TestClient(app), route
    sys.modules.pop(name, None)
    if previous is not None:
        sys.modules[name] = previous


@pytest.mark.parametrize('method', METHODS)
@pytest.mark.parametrize('specialized', [True, False])
def test_actual_mounted_methods_run_native_geometry_and_adam(mounted, method, specialized):
    client, route = mounted
    path = '/ssl/pretrain' + ('/' + method if specialized else '')
    response = client.post(path, json={'method': method, 'epochs': 1, 'batch_size': 2, 'data_size': 2})
    assert response.status_code == 200, response.text
    selected = getattr(route, method + '_trainer')
    assert selected.optimizer.state
    result = response.json()['data'] if specialized else response.json()['data']['results']
    assert result['method'] == method
    assert torch.isfinite(torch.tensor(result['final_loss']))


@pytest.mark.parametrize('field,value', [('method', 'unknown'), ('epochs', True), ('epochs', 1.5),
                                        ('epochs', 0), ('batch_size', 0), ('data_size', -1),
                                        ('data_size', 10001)])
def test_actual_route_rejects_invalid_policy_before_allocation(mounted, field, value):
    client, route = mounted
    before = snapshot(route.simclr_trainer)
    response = client.post('/ssl/pretrain', json={field: value})
    assert response.status_code == 422, response.text
    same(snapshot(route.simclr_trainer), before)


def test_mounted_work_cap_and_native_failure_are_distinct(mounted):
    client, route = mounted
    response = client.post('/ssl/pretrain/mae', json={'epochs': 100, 'data_size': 10000})
    assert response.status_code == 422
    route.simclr_trainer.optimizer.param_groups[0].update(lr=1e30, weight_decay=1e30)
    before = snapshot(route.simclr_trainer)
    response = client.post('/ssl/pretrain/simclr', json={'epochs': 1, 'data_size': 2})
    assert response.status_code == 500
    same(snapshot(route.simclr_trainer), before)


def test_later_failure_retains_earlier_accepted_minibatch():
    t = native('moco')
    accepted = []

    def after_step(optimizer, args, kwargs):
        if not accepted:
            accepted.append(snapshot(t))
        else:
            raise RuntimeError('second native batch failed')

    hook = t.optimizer.register_step_post_hook(after_step)
    try:
        with pytest.raises(RuntimeError, match='second'):
            run(t, 'moco', torch.ones(2, 2), batch_size=1)
    finally:
        hook.remove()
    same(snapshot(t), accepted[0])


def test_operations_on_one_trainer_do_not_interleave_native_updates():
    from concurrent.futures import ThreadPoolExecutor, TimeoutError
    from threading import Event

    t = native('simclr')
    entered, release, second_started = Event(), Event(), Event()
    calls = []

    def hold_first(module, args):
        calls.append(1)
        if len(calls) == 1:
            entered.set()
            assert release.wait(10)

    def second():
        second_started.set()
        return run(t, 'simclr')

    hook = t.model.register_forward_pre_hook(hold_first)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(run, t, 'simclr')
            assert entered.wait(10)
            other = pool.submit(second)
            assert second_started.wait(10)
            try:
                with pytest.raises(TimeoutError):
                    other.result(timeout=.05)
                assert len(calls) == 1
            finally:
                release.set()
            assert first.result(timeout=10)['method'] == other.result(timeout=10)['method'] == 'simclr'
    finally:
        release.set()
        hook.remove()
    assert len(calls) == 4  # two views in each complete serialized operation


def test_contrastive_pair_work_rejected_before_allocation_or_update(mounted):
    client, route = mounted
    before = snapshot(route.simclr_trainer)
    response = client.post('/ssl/pretrain/simclr',
                           json={'epochs': 1, 'data_size': 8192, 'batch_size': 8192})
    assert response.status_code == 422
    same(snapshot(route.simclr_trainer), before)
