"""Genuine two-population reward objective, native Adam and ownership controls."""

import copy
import threading
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest
import torch
from imitation.model import ImitationLearningModel, InverseRL


def native(dtype=torch.float32):
    torch.manual_seed(13)
    obj = InverseRL(state_dim=3, action_dim=2, hidden_dim=8)
    obj.reward_model.to(dtype=dtype)
    return obj


def data(dtype=np.float64):
    return (
        np.full((3, 3), 0.2, dtype=dtype),
        np.full((3, 2), 0.1, dtype=dtype),
        np.full((4, 3), -0.3, dtype=dtype),
        np.full((4, 2), -0.1, dtype=dtype),
    )


def snapshot(obj):
    return copy.deepcopy(
        (
            obj.reward_model.state_dict(),
            obj.optimizer.state_dict(),
            [p.grad for p in obj.reward_model.parameters()],
            [m.training for m in obj.reward_model.modules()],
        )
    )


def equal(a, b):
    if isinstance(a, torch.Tensor):
        torch.testing.assert_close(a, b, rtol=0, atol=0, equal_nan=True)
    elif isinstance(a, dict):
        assert a.keys() == b.keys()
        for key in a:
            equal(a[key], b[key])
    elif isinstance(a, (tuple, list)):
        assert len(a) == len(b)
        for x, y in zip(a, b):
            equal(x, y)
    else:
        assert a == b


@pytest.mark.parametrize("dtype", [torch.float32, torch.float64])
@pytest.mark.parametrize("epochs", [1, 3])
def test_independent_native_mean_difference_and_adam(dtype, epochs):
    obj = native(dtype)
    obj.infer_reward(data()[0][0], data()[1][0])
    reference = copy.deepcopy(obj.reward_model)
    opt = torch.optim.Adam(reference.parameters(), lr=1e-3)
    expert = torch.tensor(np.concatenate(data()[:2], axis=1), dtype=dtype)
    learner = torch.tensor(np.concatenate(data()[2:], axis=1), dtype=dtype)
    random_before = torch.get_rng_state()
    expected = []
    for _ in range(epochs):
        reference.train()
        opt.zero_grad()
        loss = -reference(expert).mean() + reference(learner).mean()
        loss.backward()
        opt.step()
        expected.append(loss.item())
    torch.set_rng_state(random_before)
    actual = obj.train_reward_model(*data(), epochs=epochs)
    assert actual == {"losses": expected, "final_loss": expected[-1]}
    equal(obj.reward_model.state_dict(), reference.state_dict())
    equal(obj.optimizer.state_dict(), opt.state_dict())
    assert obj.reward_model.training


@pytest.mark.parametrize("field", range(4))
@pytest.mark.parametrize(
    "problem", ["nan", "infinity", "empty", "width", "row_pair", "complex", "bool"]
)
def test_complete_bad_population_rejected_before_modes_gradients_rng(field, problem):
    obj = native()
    values = list(data())
    value = values[field]
    if problem == "nan":
        value[-1, -1] = np.nan
    elif problem == "infinity":
        value[-1, -1] = np.inf
    elif problem == "empty":
        values[field] = value[:0]
    elif problem == "width":
        values[field] = value[:, :-1]
    elif problem == "row_pair":
        values[field] = value[:-1]
    elif problem == "complex":
        values[field] = value.astype(np.complex128)
    elif problem == "bool":
        values[field] = value.astype(bool)
    obj.reward_model.eval()
    obj.reward_model[3].train()
    for p in obj.reward_model.parameters():
        p.grad = torch.full_like(p, 0.03)
    before, rng = snapshot(obj), torch.get_rng_state().clone()
    with pytest.raises((ValueError, TypeError)):
        obj.train_reward_model(*values, epochs=1)
    equal(snapshot(obj), before)
    assert torch.equal(torch.get_rng_state(), rng)


@pytest.mark.parametrize("epochs", [0, -1, True, 1.5, 1001])
def test_epoch_policy_precedes_native_work(epochs):
    obj = native()
    before = snapshot(obj)
    with pytest.raises(ValueError):
        obj.train_reward_model(*data(), epochs=epochs)
    equal(snapshot(obj), before)


def test_late_float64_observation_overflow_and_bounded_row_work():
    obj = native()
    values = list(data())
    values[-1][-1, -1] = 1e100
    before = snapshot(obj)
    with pytest.raises(ValueError):
        obj.train_reward_model(*values, epochs=1)
    with pytest.raises(ValueError):
        obj.train_reward_model(
            np.zeros((10001, 3)), np.zeros((10001, 2)), *data()[2:], epochs=1
        )
    with pytest.raises(ValueError):
        obj.train_reward_model(
            np.zeros((3000, 3)),
            np.zeros((3000, 2)),
            np.zeros((3000, 3)),
            np.zeros((3000, 2)),
            epochs=1000,
        )
    equal(snapshot(obj), before)


@pytest.mark.parametrize("dtype,decay", [(torch.float32, 1e30), (torch.float64, 1e200)])
def test_real_native_moment_corruption_recovers_and_retry_matches_reference(
    dtype, decay
):
    obj = native(dtype)
    obj.train_reward_model(*data(), epochs=1)
    obj.reward_model.eval()
    obj.reward_model[3].train()
    for p in obj.reward_model.parameters():
        p.grad = torch.full_like(p, 0.003)
    obj.optimizer.param_groups[0]["weight_decay"] = decay
    before = snapshot(obj)
    identities = [id(p) for p in obj.reward_model.parameters()]
    with pytest.raises((ValueError, RuntimeError)):
        obj.train_reward_model(*data(), epochs=1)
    equal(snapshot(obj), before)
    assert identities == [id(p) for p in obj.reward_model.parameters()]
    obj.optimizer.param_groups[0]["weight_decay"] = 0
    reference = copy.deepcopy(obj.reward_model)
    opt = torch.optim.Adam(reference.parameters(), lr=0.001)
    opt.load_state_dict(copy.deepcopy(obj.optimizer.state_dict()))
    expert = torch.tensor(np.concatenate(data()[:2], axis=1), dtype=dtype)
    learner = torch.tensor(np.concatenate(data()[2:], axis=1), dtype=dtype)
    rng = torch.get_rng_state()
    reference.train()
    opt.zero_grad()
    loss = -reference(expert).mean() + reference(learner).mean()
    loss.backward()
    opt.step()
    torch.set_rng_state(rng)
    assert obj.train_reward_model(*data(), epochs=1)["final_loss"] == loss.item()
    equal(obj.reward_model.state_dict(), reference.state_dict())
    equal(obj.optimizer.state_dict(), opt.state_dict())


@pytest.mark.parametrize("phase", ["native_step", "native_output", "derivative"])
def test_ordinary_partial_native_failure_restores_prior(phase, monkeypatch):
    obj = native()
    obj.train_reward_model(*data(), epochs=1)
    obj.reward_model.eval()
    before = snapshot(obj)
    original = obj.optimizer.step
    hook = None
    if phase == "native_step":

        def broken(*a, **kw):
            original(*a, **kw)
            raise RuntimeError("after native Adam")

        monkeypatch.setattr(obj.optimizer, "step", broken)
    elif phase == "native_output":
        hook = obj.reward_model.register_forward_hook(
            lambda _m, _i, out: out * float("nan")
        )
    else:
        hook = next(obj.reward_model.parameters()).register_hook(
            lambda grad: grad * float("nan")
        )
    try:
        with pytest.raises((ValueError, RuntimeError)):
            obj.train_reward_model(*data(), epochs=1)
    finally:
        if hook:
            hook.remove()
    equal(snapshot(obj), before)


def test_earlier_accepted_epoch_retained_after_later_failure(monkeypatch):
    obj = native()
    original = obj.optimizer.step
    accepted = []

    def partial(*a, **kw):
        original(*a, **kw)
        if not accepted:
            accepted.append(snapshot(obj))
        else:
            raise RuntimeError("second epoch fault")

    monkeypatch.setattr(obj.optimizer, "step", partial)
    with pytest.raises(RuntimeError):
        obj.train_reward_model(*data(), epochs=2)
    equal(snapshot(obj), accepted[0])


def test_owned_populations_survive_caller_mutation_during_native_work():
    obj = native()
    reference = native()
    values = list(data())
    rng = torch.get_rng_state()
    expected = reference.train_reward_model(*data(), epochs=2)
    torch.set_rng_state(rng)

    def mutate(_m, _i):
        for value in values:
            value.fill(123)

    hook = obj.reward_model.register_forward_pre_hook(mutate)
    try:
        actual = obj.train_reward_model(*values, epochs=2)
    finally:
        hook.remove()
    assert actual == expected
    equal(obj.reward_model.state_dict(), reference.reward_model.state_dict())
    equal(obj.optimizer.state_dict(), reference.optimizer.state_dict())


@pytest.mark.parametrize("dtype", [torch.float32, torch.float64])
def test_owned_scalar_inference_restores_modes_and_gradients(dtype):
    obj = native(dtype)
    obj.reward_model.train()
    obj.reward_model[3].eval()
    before = snapshot(obj)
    state, action = data()[0][0], data()[1][0]
    reference = copy.deepcopy(obj.reward_model)
    reference.eval()
    expected = reference(torch.tensor(np.r_[state, action], dtype=dtype)[None]).item()
    assert obj.infer_reward(state, action) == expected
    equal(snapshot(obj), before)
    with pytest.raises(ValueError):
        obj.infer_reward(np.full(3, np.nan), action)
    equal(snapshot(obj), before)


def test_reward_inference_and_aggregate_checkpoint_wait_for_training(
    tmp_path, monkeypatch
):
    aggregate = ImitationLearningModel(state_dim=3, action_dim=2, hidden_dim=8)
    obj = aggregate.inverse_rl
    entered = threading.Event()
    release = threading.Event()
    original = obj.optimizer.step

    def paused(*a, **kw):
        entered.set()
        assert release.wait(5)
        return original(*a, **kw)

    monkeypatch.setattr(obj.optimizer, "step", paused)
    with ThreadPoolExecutor(max_workers=3) as pool:
        fit = pool.submit(obj.train_reward_model, *data(), epochs=1)
        assert entered.wait(5)
        read = pool.submit(obj.infer_reward, data()[0][0], data()[1][0])
        save = pool.submit(aggregate.save, tmp_path / "reward.pth")
        assert not read.done() and not save.done()
        release.set()
        fit.result(5)
        read.result(5)
        save.result(5)
    saved = torch.load(tmp_path / "reward.pth", weights_only=True)
    equal(saved["irl_state_dict"], obj.reward_model.state_dict())


@pytest.mark.parametrize("dtype", [torch.float32, torch.float64])
def test_python_list_observations_preserve_native_population_reference(dtype):
    obj = native(dtype)
    reference = native(dtype)
    rng = torch.get_rng_state()
    expected = reference.train_reward_model(*data(), epochs=1)
    torch.set_rng_state(rng)
    actual = obj.train_reward_model(*(part.tolist() for part in data()), epochs=1)
    assert actual == expected
    equal(obj.reward_model.state_dict(), reference.reward_model.state_dict())


def test_native_aggregate_copy_gets_independent_lock_and_state():
    aggregate = ImitationLearningModel(state_dim=3, action_dim=2, hidden_dim=8)
    aggregate.train_irl(*data(), epochs=1)
    other = copy.deepcopy(aggregate)
    equal(
        aggregate.inverse_rl.reward_model.state_dict(),
        other.inverse_rl.reward_model.state_dict(),
    )
    equal(
        aggregate.inverse_rl.optimizer.state_dict(),
        other.inverse_rl.optimizer.state_dict(),
    )
    assert all(p.grad is None for p in other.inverse_rl.reward_model.parameters())
    assert other.inverse_rl._operation_lock is not aggregate.inverse_rl._operation_lock
    other.train_irl(*data(), epochs=1)
    assert not torch.equal(
        next(aggregate.inverse_rl.reward_model.parameters()),
        next(other.inverse_rl.reward_model.parameters()),
    )


def test_inference_native_failure_restores_mixed_modes():
    obj = native()
    obj.reward_model.train()
    obj.reward_model[3].eval()
    before = snapshot(obj)
    hook = obj.reward_model.register_forward_hook(
        lambda _m, _i, out: out * float("nan")
    )
    try:
        with pytest.raises(ValueError):
            obj.infer_reward(data()[0][0], data()[1][0])
    finally:
        hook.remove()
    equal(snapshot(obj), before)
