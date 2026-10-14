"""Real categorical objective/Adam references, ownership and failed transitions."""

import copy
import threading
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest
import torch
from imitation.model import ImitationLearningModel, PolicyGradient


def trainer(dtype=torch.float32):
    torch.manual_seed(41)
    owner = PolicyGradient(2, 2, 8)
    owner.policy.to(dtype=dtype)
    for module in owner.policy.modules():
        if isinstance(module, torch.nn.Dropout):
            module.p = 0
    return owner


def batch():
    return (
        np.array([[0.2, -0.4], [0.7, 0.1], [-0.2, 0.5]]),
        np.array([1, 0, 1]),
        np.array([0.4, -0.3, 0.8]),
    )


def snapshot(owner):
    return (
        copy.deepcopy(owner.policy.state_dict()),
        copy.deepcopy(owner.optimizer.state_dict()),
        [None if p.grad is None else p.grad.clone() for p in owner.policy.parameters()],
        [m.training for m in owner.policy.modules()],
        [id(p) for p in owner.policy.parameters()],
    )


def same_tree(a, b):
    if isinstance(a, torch.Tensor):
        torch.testing.assert_close(a, b, rtol=0, atol=0)
    elif isinstance(a, dict):
        assert a.keys() == b.keys()
        for key in a:
            same_tree(a[key], b[key])
    elif isinstance(a, (list, tuple)):
        assert len(a) == len(b)
        for x, y in zip(a, b):
            same_tree(x, y)
    else:
        assert a == b


@pytest.mark.parametrize("dtype", [torch.float32, torch.float64])
@pytest.mark.parametrize("count", [1, 3])
def test_independent_native_objective_gradient_clipping_and_first_adam(dtype, count):
    owner = trainer(dtype)
    reference = copy.deepcopy(owner.policy)
    states, actions, rewards = (value[:count] for value in batch())
    logits = reference[:-1](torch.tensor(states, dtype=dtype))
    selected = torch.log_softmax(logits, -1)[torch.arange(count), torch.tensor(actions)]
    loss = -(selected * torch.tensor(rewards, dtype=dtype)).mean()
    loss.backward()
    torch.nn.utils.clip_grad_norm_(reference.parameters(), 1.0, error_if_nonfinite=True)
    grads = [p.grad.clone() for p in reference.parameters()]
    before = [p.detach().clone() for p in reference.parameters()]
    result = owner.train_step(states, actions, rewards[:, None])
    assert result == pytest.approx(loss.item(), rel=1e-6)
    group = owner.optimizer.param_groups[0]
    beta1, beta2 = group["betas"]
    for p, w, g in zip(owner.policy.parameters(), before, grads):
        torch.testing.assert_close(p.grad, g)
        moment = (1 - beta1) * g
        variance = (1 - beta2) * g.square()
        expected = w - group["lr"] * (moment / (1 - beta1)) / (
            (variance / (1 - beta2)).sqrt() + group["eps"]
        )
        torch.testing.assert_close(p, expected)
        torch.testing.assert_close(owner.optimizer.state[p]["exp_avg"], moment)
        torch.testing.assert_close(owner.optimizer.state[p]["exp_avg_sq"], variance)
        assert owner.optimizer.state[p]["step"].item() == 1


@pytest.mark.parametrize("dtype", [torch.float32, torch.float64])
def test_real_finite_policy_moment_overflow_restores_and_corrected_retry(dtype):
    owner = trainer(dtype)
    owner.train_step(*batch())
    owner.policy.eval()
    owner.policy[2].train()
    for p in owner.policy.parameters():
        p.grad = torch.full_like(p, 0.03)
    # Float64 needs a larger finite decay to overflow its second moment.
    owner.optimizer.param_groups[0]["weight_decay"] = (
        1e30 if dtype == torch.float32 else 1e200
    )
    before = snapshot(owner)
    with pytest.raises(ValueError, match="nonfinite"):
        owner.train_step(*batch())
    same_tree(before, snapshot(owner))
    owner.optimizer.param_groups[0]["weight_decay"] = 0
    reference = copy.deepcopy(owner)
    assert owner.train_step(*batch()) == reference.train_step(*batch())
    same_tree(owner.policy.state_dict(), reference.policy.state_dict())
    same_tree(owner.optimizer.state_dict(), reference.optimizer.state_dict())


def test_real_native_partial_step_exception_restores_all_and_retry(monkeypatch):
    owner = trainer()
    owner.train_step(*batch())
    owner.policy.eval()
    owner.policy[2].train()
    before = snapshot(owner)
    original = owner.optimizer.step

    def partial(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("after actual native Adam")

    monkeypatch.setattr(owner.optimizer, "step", partial)
    with pytest.raises(RuntimeError, match="actual native"):
        owner.train_step(*batch())
    same_tree(before, snapshot(owner))
    monkeypatch.setattr(owner.optimizer, "step", original)
    assert np.isfinite(owner.train_step(*batch()))


@pytest.mark.parametrize("bad", [True, 0, -1, 1.5, 1001, "1"])
def test_complete_integral_epoch_admission_precedes_rng_modes_and_updates(bad):
    owner = trainer()
    owner.policy.eval()
    states, actions, rewards = batch()
    before, rng = snapshot(owner), torch.get_rng_state().clone()
    trajectory = {"states": states, "actions": actions, "rewards": rewards}
    with pytest.raises(ValueError):
        owner.train([trajectory], epochs=bad)
    same_tree(before, snapshot(owner))
    torch.testing.assert_close(rng, torch.get_rng_state())


@pytest.mark.parametrize("bad", [True, 0, -1, 1.5, 10001, "2"])
def test_complete_integral_batch_policy_admission(bad):
    owner = trainer()
    states, actions, rewards = batch()
    before = snapshot(owner)
    with pytest.raises(ValueError):
        owner.train(
            [{"states": states, "actions": actions, "rewards": rewards}], batch_size=bad
        )
    same_tree(before, snapshot(owner))


@pytest.mark.parametrize(
    "bad", [None, {}, [None], [{}], [{"states": [[1, 2]], "actions": [0]}]]
)
def test_malformed_complete_trajectories_reject_without_mutation(bad):
    owner = trainer()
    before = snapshot(owner)
    with pytest.raises(ValueError):
        owner.train(bad)
    same_tree(before, snapshot(owner))


def test_total_rows_and_row_epoch_budget_precedes_first_step():
    owner = trainer()
    t = {
        "states": np.zeros((2501, 2)),
        "actions": np.zeros(2501),
        "rewards": np.ones(2501),
    }
    before = snapshot(owner)
    with pytest.raises(ValueError, match="budget"):
        owner.train([t], epochs=1000)
    with pytest.raises(ValueError, match="budget"):
        owner.train([t] * 4, epochs=1)
    same_tree(before, snapshot(owner))


@pytest.mark.parametrize("kind", ["nan", "complex", "bool", "overflow", "late"])
def test_native_observation_admission_before_modes_gradients_rng(kind):
    owner = trainer()
    states, actions, rewards = batch()
    if kind == "nan":
        states[-1, -1] = np.nan
    elif kind == "complex":
        states = states.astype(complex)
    elif kind == "bool":
        actions = actions.astype(bool)
    elif kind == "overflow":
        states[-1, -1] = 1e100
    elif kind == "late":
        rewards = rewards[:-1]
    before, rng = snapshot(owner), torch.get_rng_state().clone()
    with pytest.raises(ValueError):
        owner.train_step(states, actions, rewards)
    same_tree(before, snapshot(owner))
    torch.testing.assert_close(rng, torch.get_rng_state())


def test_late_bad_trajectory_rejects_before_shuffle_or_first_step():
    owner = trainer()
    states, actions, rewards = batch()
    before = snapshot(owner)
    rng = np.random.get_state()
    with pytest.raises(ValueError):
        owner.train(
            [
                {"states": states, "actions": actions, "rewards": rewards},
                {"states": states, "actions": actions, "rewards": [1]},
            ],
            epochs=2,
        )
    same_tree(before, snapshot(owner))
    after = np.random.get_state()
    assert rng[0] == after[0] and rng[2:] == after[2:]
    np.testing.assert_array_equal(rng[1], after[1])


@pytest.mark.parametrize("input_kind", ["numpy", "tensor"])
def test_direct_batch_owns_source_before_native_forward(input_kind):
    owner = trainer()
    reference = copy.deepcopy(owner)
    states, actions, rewards = batch()
    states = states.astype(np.float32)
    if input_kind == "tensor":
        states = torch.from_numpy(states)
    expected = reference.train_step(states, actions, rewards)

    def mutate(*_):
        if isinstance(states, torch.Tensor):
            states.fill_(float("nan"))
        else:
            states[:] = np.nan
        actions[:] = 999
        rewards[:] = np.nan

    hook = owner.policy[0].register_forward_pre_hook(mutate)
    assert owner.train_step(states, actions, rewards) == expected
    hook.remove()
    same_tree(owner.policy.state_dict(), reference.policy.state_dict())


def test_earlier_native_accepted_batch_remains_after_later_failure(monkeypatch):
    owner = trainer()
    states, actions, rewards = batch()
    actual_step = owner.optimizer.step
    accepted = []

    def step(*args, **kwargs):
        actual_step(*args, **kwargs)
        if not accepted:
            accepted.append(copy.deepcopy(owner.policy.state_dict()))
        else:
            raise RuntimeError("later batch")

    monkeypatch.setattr(owner.optimizer, "step", step)
    with pytest.raises(RuntimeError, match="later batch"):
        owner.train(
            [{"states": states, "actions": actions, "rewards": rewards}],
            epochs=1,
            batch_size=1,
        )
    same_tree(accepted[0], owner.policy.state_dict())
    assert all(state["step"].item() == 1 for state in owner.optimizer.state.values())


@pytest.mark.parametrize("dtype", [torch.float32, torch.float64])
@pytest.mark.parametrize("explore", [False, True])
def test_inference_restores_mixed_modes_gradients_and_integer_semantics(dtype, explore):
    owner = trainer(dtype)
    owner.policy.train()
    owner.policy[2].eval()
    for p in owner.policy.parameters():
        p.grad = torch.full_like(p, 0.07)
    before = snapshot(owner)
    state = np.array([0.2, -0.4])
    ref = copy.deepcopy(owner.policy).eval()
    probabilities = ref(torch.tensor(state, dtype=dtype)[None])
    torch.manual_seed(73)
    expected = int(
        torch.multinomial(probabilities, 1).item()
        if explore
        else probabilities.argmax().item()
    )
    torch.manual_seed(73)
    assert owner.get_action(state, explore) == expected
    same_tree(before, snapshot(owner))


@pytest.mark.parametrize(
    "state", [[1], [[1, 2], [3, 4]], [float("nan"), 0], [True, False]]
)
def test_scalar_inference_admits_complete_observation_before_modes(state):
    owner = trainer()
    before = snapshot(owner)
    with pytest.raises(ValueError):
        owner.get_action(state, False)
    same_tree(before, snapshot(owner))


def test_failed_native_inference_restores_modes():
    owner = trainer()
    owner.policy[2].eval()
    with torch.no_grad():
        owner.policy[-2].bias.fill_(float("nan"))
    modes = [m.training for m in owner.policy.modules()]
    with pytest.raises(ValueError, match="categorical"):
        owner.get_action([0, 0], False)
    assert [m.training for m in owner.policy.modules()] == modes


@pytest.mark.parametrize("operation", ["infer", "save", "load"])
def test_native_operation_fence_blocks_until_admitted_step_finishes(
    operation, tmp_path
):
    aggregate = ImitationLearningModel(2, 2, 8)
    owner = aggregate.policy_gradient
    for m in owner.policy.modules():
        if isinstance(m, torch.nn.Dropout):
            m.p = 0
    path = tmp_path / "native.pth"
    aggregate.save(str(path))
    entered, release, started, finished = (threading.Event() for _ in range(4))
    original = owner.optimizer.step

    def paused(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        return original(*args, **kwargs)

    owner.optimizer.step = paused

    def other():
        started.set()
        result = (
            owner.get_action([0, 0], False)
            if operation == "infer"
            else getattr(aggregate, operation)(str(path))
        )
        finished.set()
        return result

    with ThreadPoolExecutor(2) as pool:
        fitting = pool.submit(owner.train_step, *batch())
        assert entered.wait(5)
        reading = pool.submit(other)
        assert started.wait(5)
        assert not finished.wait(0.05)
        release.set()
        assert np.isfinite(fitting.result(5))
        reading.result(5)
    assert finished.is_set()


def test_native_aggregate_copy_has_independent_policy_lock():
    original = ImitationLearningModel(2, 2, 8)
    cloned = copy.deepcopy(original)
    assert (
        cloned.policy_gradient._operation_lock
        is not original.policy_gradient._operation_lock
    )
    assert np.isfinite(cloned.policy_gradient.train_step(*batch()))
    assert not original.policy_gradient.optimizer.state


@pytest.mark.parametrize("dtype", [torch.float32, torch.float64])
def test_complete_fit_retains_population_normalization_and_native_batch_updates(
    dtype, monkeypatch
):
    owner = trainer(dtype)
    reference = copy.deepcopy(owner.policy)
    optimizer = torch.optim.Adam(reference.parameters(), lr=1e-3)
    states, actions, rewards = batch()
    # Match the original native admitted population precision before float64 normalization.
    native_rewards = torch.tensor(rewards, dtype=dtype).numpy().astype(np.float64)
    normalized = (native_rewards - native_rewards.mean()) / (
        native_rewards.std() + 1e-8
    )
    monkeypatch.setattr(np.random, "permutation", lambda count: np.arange(count))
    losses = []
    for start in (0, 2):
        selected = torch.log_softmax(
            reference[:-1](torch.tensor(states[start : start + 2], dtype=dtype)), -1
        )
        selected = selected[
            torch.arange(len(selected)), torch.tensor(actions[start : start + 2])
        ]
        loss = -(
            selected * torch.tensor(normalized[start : start + 2], dtype=dtype)
        ).mean()
        optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(
            reference.parameters(), 1.0, error_if_nonfinite=True
        )
        optimizer.step()
        losses.append(loss.item())
    result = owner.train(
        [{"states": states, "actions": actions, "rewards": rewards}],
        epochs=1,
        batch_size=2,
    )
    assert result["final_loss"] == pytest.approx(sum(losses) / 2)
    same_tree(owner.policy.state_dict(), reference.state_dict())
    same_tree(owner.optimizer.state_dict(), optimizer.state_dict())


def test_complete_fit_owns_trajectory_population_before_first_native_step():
    owner = trainer()
    reference = copy.deepcopy(owner)
    states, actions, rewards = batch()
    trajectory = {"states": states, "actions": actions, "rewards": rewards}
    np.random.seed(53)
    expected = reference.train([trajectory], epochs=2, batch_size=2)
    original = owner.optimizer.step

    def mutate(*args, **kwargs):
        states[:] = np.nan
        actions[:] = 999
        rewards[:] = np.nan
        return original(*args, **kwargs)

    owner.optimizer.step = mutate
    np.random.seed(53)
    assert owner.train([trajectory], epochs=2, batch_size=2) == expected
    same_tree(owner.policy.state_dict(), reference.policy.state_dict())


@pytest.mark.parametrize(
    "option,value",
    [
        ("lr", float("nan")),
        ("eps", -1.0),
        ("fused", True),
        ("capturable", True),
        ("differentiable", True),
    ],
)
def test_native_policy_admission_precedes_dropout_and_mode_changes(option, value):
    owner = trainer()
    owner.policy.eval()
    owner.optimizer.param_groups[0][option] = value
    modes, rng = (
        [m.training for m in owner.policy.modules()],
        torch.get_rng_state().clone(),
    )
    with pytest.raises(ValueError):
        owner.train_step(*batch())
    assert not owner.optimizer.state
    assert modes == [m.training for m in owner.policy.modules()]
    torch.testing.assert_close(rng, torch.get_rng_state())
