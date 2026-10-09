"""Actual denoiser/noise/AdamW references and rejected-step ownership controls."""

import copy
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
import torch
from diffusion import training_transition as contract
from diffusion.model import DiffusionRouteModel
from diffusion.trainer import DiffusionTrainer
from torch import nn
from torch.utils.data import DataLoader, TensorDataset


def native(dtype=torch.float32, lazy=False):
    torch.manual_seed(19)
    model = DiffusionRouteModel(input_dim=4, hidden_dim=16, num_layers=1,
                               num_heads=2, num_timesteps=4, cond_dim=None if lazy else 2).to(dtype)
    for module in model.modules():
        if isinstance(module, nn.Dropout):
            module.p = 0
    return DiffusionTrainer(model, device='cpu', batch_size=2)


def equal(a, b):
    if isinstance(b, torch.Tensor):
        torch.testing.assert_close(a, b, rtol=0, atol=0)
    elif isinstance(b, dict):
        assert a.keys() == b.keys()
        for key in b:
            equal(a[key], b[key])
    elif isinstance(b, (list, tuple)):
        assert len(a) == len(b)
        for x, y in zip(a, b):
            equal(x, y)
    else:
        assert a == b


def state(t):
    return (copy.deepcopy(t.model.state_dict()), copy.deepcopy(t.optimizer.state_dict()),
            [None if p.grad is None else p.grad.clone() for p in t.model.parameters()],
            [m.training for m in t.model.modules()], t.train_losses.copy(), t.val_losses.copy())


@pytest.mark.parametrize('dtype', [torch.float32, torch.float64])
@pytest.mark.parametrize('conditional', [False, True])
def test_actual_noise_mse_gradient_clipping_and_independent_first_adamw(dtype, conditional):
    t = native(dtype)
    reference = copy.deepcopy(t.model)
    x = torch.linspace(-1, 1, 24, dtype=dtype).reshape(2, 3, 4)
    condition = torch.ones(2, 3, 2, dtype=dtype) if conditional else None
    rng = torch.get_rng_state()
    times = torch.randint(0, 4, (2,))
    noise = torch.randn_like(x)
    noisy = reference.add_noise(x, times, noise)
    if conditional:
        noisy = torch.cat((noisy, condition), -1)
    reference.train()
    predicted = reference.denoise(noisy, times)
    expected_loss = (predicted - noise).square().sum() / noise.numel()
    expected_loss.backward()
    norm = torch.linalg.vector_norm(torch.stack([
        torch.linalg.vector_norm(p.grad) for p in reference.parameters() if p.grad is not None]))
    coefficient = torch.clamp(1 / (norm + 1e-6), max=1)
    group = t.optimizer.param_groups[0]
    expected = []
    for p in reference.parameters():
        if p.grad is None:
            expected.append((p.detach().clone(), None, None))
        else:
            g = p.grad * coefficient
            updated = p.detach() * (1 - group['lr'] * group['weight_decay']) - group['lr'] * g / (g.abs() + group['eps'])
            expected.append((updated, (1-group['betas'][0])*g, (1-group['betas'][1])*g.square()))
    torch.set_rng_state(rng)
    observed = t.train_step(x, condition)
    assert observed == pytest.approx(expected_loss.item(), rel=1e-7)
    tolerance = 2e-7 if dtype == torch.float32 else 1e-12
    for p, (weight, first, second) in zip(t.model.parameters(), expected):
        torch.testing.assert_close(p, weight, rtol=tolerance, atol=tolerance)
        if first is not None:
            actual = t.optimizer.state[p]
            torch.testing.assert_close(actual['exp_avg'], first, rtol=tolerance, atol=tolerance)
            torch.testing.assert_close(actual['exp_avg_sq'], second, rtol=tolerance, atol=tolerance)
            assert actual['step'].item() == 1


@pytest.mark.parametrize('bad', ['nan_data', 'inf_condition', 'dtype', 'width', 'bool_epochs', 'float_epochs', 'zero_epochs', 'batch', 'heldout'])
def test_complete_admission_preserves_native_state_and_rng(bad):
    t = native(); x = torch.ones(2, 3, 4); c = torch.ones(2, 3, 2)
    args = {'epochs': 1, 'condition_data': c}
    if bad == 'nan_data': x[-1,-1,-1] = torch.nan
    if bad == 'inf_condition': c[-1,-1,-1] = torch.inf
    if bad == 'dtype': x = x.double()
    if bad == 'width': args['condition_data'] = torch.ones(2,3,3)
    if bad == 'bool_epochs': args['epochs'] = True
    if bad == 'float_epochs': args['epochs'] = 1.0
    if bad == 'zero_epochs': args['epochs'] = 0
    if bad == 'batch': t.batch_size = True
    if bad == 'heldout':
        args.update(val_data=torch.full((2,3,4),torch.nan), val_condition_data=c)
    before = state(t); rng = torch.get_rng_state().clone()
    with pytest.raises(ValueError): t.train(x, **args)
    equal(state(t), before); assert torch.equal(torch.get_rng_state(), rng)


def test_finite_native_adamw_overflow_recovers_registered_state_and_can_retry():
    t = native(); x = torch.ones(2,3,4)
    t.train_step(x)
    for p in t.model.parameters(): p.grad = torch.ones_like(p)
    t.model.eval(); t.model.blocks[0].train()
    identities = [id(p) for p in t.model.parameters()]
    t.optimizer.param_groups[0].update(lr=1e20, weight_decay=1e20)
    before = state(t)
    with pytest.raises((ValueError, RuntimeError, OverflowError)): t.train_step(x)
    equal(state(t), before); assert identities == [id(p) for p in t.model.parameters()]
    t.optimizer.param_groups[0].update(lr=1e-4, weight_decay=.01)
    assert torch.isfinite(torch.tensor(t.train_step(x)))
    assert all(s['step'].item() == 2 for s in t.optimizer.state.values())


def test_ordinary_failure_after_actual_native_step_recovers_prior_moments(monkeypatch):
    t = native(); x = torch.ones(2,3,4); t.train_step(x)
    before = state(t); actual = t.optimizer.step
    def fail(*a, **kw):
        actual(*a, **kw)
        raise RuntimeError('ordinary post-step failure')
    monkeypatch.setattr(t.optimizer, 'step', fail)
    with pytest.raises(RuntimeError): t.train_step(x)
    equal(state(t), before)


def test_unused_lazy_projection_and_admitted_initialization_boundary(monkeypatch):
    t = native(lazy=True); x = torch.ones(2,3,4)
    parameter = t.model.cond_proj.weight; identity = id(parameter)
    assert torch.isfinite(torch.tensor(t.train_step(x)))
    assert isinstance(parameter, nn.parameter.UninitializedParameter)
    rng = torch.get_rng_state().clone(); bad = x.clone(); bad[-1,-1,-1] = torch.nan
    with pytest.raises(ValueError): t.train_step(bad, torch.ones(2,2))
    assert isinstance(parameter, nn.parameter.UninitializedParameter)
    assert torch.equal(rng, torch.get_rng_state())
    original = t.optimizer.step
    captured = []
    def fail(*a, **kw):
        captured.append(t.model.cond_proj.weight.clone())
        original(*a, **kw)
        raise RuntimeError('after admitted initialization')
    monkeypatch.setattr(t.optimizer, 'step', fail)
    with pytest.raises(RuntimeError): t.train_step(x, torch.ones(2,2))
    assert id(t.model.cond_proj.weight) == identity
    torch.testing.assert_close(t.model.cond_proj.weight, captured[0], rtol=0, atol=0)
    assert parameter not in t.optimizer.state
    monkeypatch.setattr(t.optimizer, 'step', original)
    assert torch.isfinite(torch.tensor(t.train_step(x, torch.ones(2,2))))
    assert t.optimizer.state[parameter]['step'].item() == 1


def test_whole_dataset_owned_before_native_callback_mutates_caller(monkeypatch):
    t = native(); x = torch.ones(4,3,4); val = torch.ones(2,3,4)
    c = torch.ones(4,2); vc = torch.ones(2,2)
    original = t.model.add_noise
    def mutate(observed, *a):
        x.fill_(torch.nan); val.fill_(torch.nan); c.fill_(torch.nan); vc.fill_(torch.nan)
        assert torch.isfinite(observed).all()
        return original(observed, *a)
    monkeypatch.setattr(t.model, 'add_noise', mutate)
    result = t.train(x, epochs=2, val_data=val, condition_data=c, val_condition_data=vc)
    assert len(result['train_losses']) == len(result['val_losses']) == 2
    assert all(torch.isfinite(torch.tensor(result['val_losses'])))


def test_failed_later_step_retains_earlier_native_update_without_epoch_history(monkeypatch):
    t = native(); x = torch.ones(4,3,4); original = t.optimizer.step; accepted = []
    def step(*a, **kw):
        if accepted: raise RuntimeError('second candidate failure')
        original(*a, **kw)
        accepted.append((copy.deepcopy(t.model.state_dict()), copy.deepcopy(t.optimizer.state_dict())))
    monkeypatch.setattr(t.optimizer, 'step', step)
    with pytest.raises(RuntimeError): t.train(x, epochs=1)
    equal(t.model.state_dict(), accepted[0][0]); equal(t.optimizer.state_dict(), accepted[0][1])
    assert t.train_losses == t.val_losses == []


def test_validation_restores_mixed_modes_and_finite_weighted_short_tail():
    t = native(); t.model.eval(); t.model.blocks[0].train()
    modes = [m.training for m in t.model.modules()]
    loss = t.validate(DataLoader(TensorDataset(torch.ones(3,3,4)),batch_size=2))
    assert torch.isfinite(torch.tensor(loss)); assert modes == [m.training for m in t.model.modules()]


def test_native_training_owns_operation_until_denoiser_finishes(monkeypatch):
    t = native(); entered=threading.Event(); release=threading.Event(); second=threading.Event()
    original = t.model.denoise
    def wait(*a, **kw):
        entered.set(); assert release.wait(5)
        return original(*a, **kw)
    monkeypatch.setattr(t.model, 'denoise', wait)
    def validate():
        second.set()
        return t.validate(DataLoader(TensorDataset(torch.ones(1,3,4)),batch_size=1))
    with ThreadPoolExecutor(2) as pool:
        train = pool.submit(t.train_step, torch.ones(2,3,4))
        assert entered.wait(5)
        pending = pool.submit(validate); assert second.wait(5)
        assert not pending.done()
        release.set(); assert train.result(5) >= 0; assert pending.result(5) >= 0


@pytest.mark.parametrize('limit', ['MAX_VALUES', 'MAX_WORK', 'MAX_STATE'])
def test_snapshot_and_observation_budgets_reject_before_updates(monkeypatch, limit):
    t = native(); before = state(t)
    monkeypatch.setattr(contract, limit, 1)
    with pytest.raises(ValueError): t.train_step(torch.ones(2,3,4))
    equal(state(t), before)


def test_current_unvalidated_call_does_not_report_previous_validation_metric():
    t = native(); x = torch.ones(2,3,4)
    assert t.train(x, epochs=1, val_data=x)['final_val_loss'] is not None
    result = t.train(x, epochs=1)
    assert result['final_val_loss'] is None
    assert len(result['val_losses']) == 1  # cumulative history is preserved


def test_late_native_loader_numerics_are_rejected_before_first_update():
    t = native(); x = torch.ones(4,3,4); x[-1,-1,-1] = torch.nan
    before = state(t)
    with pytest.raises(ValueError):
        t.train_epoch(DataLoader(TensorDataset(x),batch_size=2))
    equal(state(t), before)


def test_lazy_train_and_validation_width_mismatch_precedes_initialization_and_rng():
    t = native(lazy=True); parameter = t.model.cond_proj.weight
    rng = torch.get_rng_state().clone()
    with pytest.raises(ValueError):
        t.train(torch.ones(2,3,4),epochs=1,condition_data=torch.ones(2,2),
                val_data=torch.ones(1,3,4),val_condition_data=torch.ones(1,3))
    assert isinstance(parameter, nn.parameter.UninitializedParameter)
    assert torch.equal(rng,torch.get_rng_state()); assert not t.optimizer.state
