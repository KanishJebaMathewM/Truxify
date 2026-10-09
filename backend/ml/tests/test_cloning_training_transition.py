"""Native continuous MSE, real Adam corruption, recovery and observation ownership."""

import copy
import threading
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest
import torch
from imitation.model import ImitationLearningModel


def trainer(dtype=torch.float32):
    torch.manual_seed(43)
    owner = ImitationLearningModel(2, 2, 8)
    owner.behavioral_cloning.to(dtype=dtype)
    for module in owner.behavioral_cloning.modules():
        if isinstance(module, torch.nn.Dropout):
            module.p = 0
    return owner


def batch():
    return np.array([[0.2, -0.4], [0.7, 0.1], [-0.2, 0.5]]), np.array(
        [[0.1, -0.3], [0.4, 0.2], [-0.1, 0.6]]
    )


def snapshot(owner):
    model = owner.behavioral_cloning
    return (
        copy.deepcopy(model.state_dict()),
        copy.deepcopy(owner.bc_optimizer.state_dict()),
        [None if p.grad is None else p.grad.clone() for p in model.parameters()],
        [m.training for m in model.modules()],
        [id(p) for p in model.parameters()],
    )


def same(a, b):
    if isinstance(a, torch.Tensor):
        torch.testing.assert_close(a, b, rtol=0, atol=0)
    elif isinstance(a, dict):
        assert a.keys() == b.keys()
        for key in a:
            same(a[key], b[key])
    elif isinstance(a, (list, tuple)):
        assert len(a) == len(b)
        for x, y in zip(a, b):
            same(x, y)
    else:
        assert a == b


@pytest.mark.parametrize("dtype", [torch.float32, torch.float64])
@pytest.mark.parametrize("count", [1, 3])
def test_independent_mse_and_first_adam(dtype, count, monkeypatch):
    owner = trainer(dtype)
    reference = copy.deepcopy(owner.behavioral_cloning)
    x, y = (v[:count] for v in batch())
    prediction = reference(torch.tensor(x, dtype=dtype))
    loss = ((prediction - torch.tensor(y, dtype=dtype)) ** 2).mean()
    loss.backward()
    gradients = [p.grad.clone() for p in reference.parameters()]
    weights = [p.detach().clone() for p in reference.parameters()]
    monkeypatch.setattr(np.random, "permutation", lambda n: np.arange(n))
    result = owner.train_behavioral_cloning(x, y, epochs=1, batch_size=count)
    assert result["losses"] == pytest.approx([loss.item()])
    group = owner.bc_optimizer.param_groups[0]
    b1, b2 = group["betas"]
    for p, w, g in zip(owner.behavioral_cloning.parameters(), weights, gradients):
        m, v = (1 - b1) * g, (1 - b2) * g.square()
        expected = w - group["lr"] * (m / (1 - b1)) / (
            (v / (1 - b2)).sqrt() + group["eps"]
        )
        torch.testing.assert_close(p, expected)
        torch.testing.assert_close(p.grad, g)
        torch.testing.assert_close(owner.bc_optimizer.state[p]["exp_avg"], m)
        torch.testing.assert_close(owner.bc_optimizer.state[p]["exp_avg_sq"], v)


@pytest.mark.parametrize("dtype", [torch.float32, torch.float64])
def test_real_finite_decay_overflow_restores_and_retry(dtype):
    owner = trainer(dtype)
    owner.train_behavioral_cloning(*batch(), epochs=1)
    owner.behavioral_cloning.eval()
    owner.behavioral_cloning.policy[2].train()
    for p in owner.behavioral_cloning.parameters():
        p.grad = torch.full_like(p, 0.03)
    owner.bc_optimizer.param_groups[0]["weight_decay"] = (
        1e30 if dtype == torch.float32 else 1e200
    )
    before = snapshot(owner)
    with pytest.raises(ValueError):
        owner.train_behavioral_cloning(*batch(), epochs=1)
    same(before, snapshot(owner))
    owner.bc_optimizer.param_groups[0]["weight_decay"] = 0
    assert np.isfinite(
        owner.train_behavioral_cloning(*batch(), epochs=1)["losses"]
    ).all()


def test_real_partial_step_exception_restores(monkeypatch):
    owner = trainer()
    owner.train_behavioral_cloning(*batch(), epochs=1)
    before = snapshot(owner)
    step = owner.bc_optimizer.step

    def fail(*args, **kwargs):
        step(*args, **kwargs)
        raise RuntimeError("after native Adam")

    monkeypatch.setattr(owner.bc_optimizer, "step", fail)
    with pytest.raises(RuntimeError, match="after native Adam"):
        owner.train_behavioral_cloning(*batch(), epochs=1)
    same(before, snapshot(owner))


@pytest.mark.parametrize(
    "epochs,size",
    [(True, 2), (0, 2), (1001, 2), (1.2, 2), (1, False), (1, 0), (1, 10001)],
)
def test_budget_rejected_before_rng(epochs, size, monkeypatch):
    owner = trainer()
    before = snapshot(owner)
    monkeypatch.setattr(
        np.random, "permutation", lambda n: pytest.fail("RNG before admission")
    )
    with pytest.raises(ValueError):
        owner.train_behavioral_cloning(*batch(), epochs=epochs, batch_size=size)
    same(before, snapshot(owner))


@pytest.mark.parametrize("bad", [np.nan, np.inf, -np.inf])
@pytest.mark.parametrize("side", [0, 1])
def test_late_observation_rejected_before_update(bad, side):
    owner = trainer()
    values = list(batch())
    values[side][-1, -1] = bad
    before = snapshot(owner)
    with pytest.raises(ValueError):
        owner.train_behavioral_cloning(*values, epochs=1, batch_size=1)
    same(before, snapshot(owner))


@pytest.mark.parametrize("dtype", [torch.float32, torch.float64])
def test_prediction_preserves_mixed_modes_gradients_and_owns_input(dtype, monkeypatch):
    owner = trainer(dtype)
    model = owner.behavioral_cloning
    model.eval()
    model.policy[2].train()
    for p in model.parameters():
        p.grad = torch.full_like(p, 0.2)
    before = snapshot(owner)
    x, _ = batch()
    expected = model(torch.tensor(x, dtype=dtype)).detach().numpy()
    forward = model.forward

    def mutate(observation):
        x[:] = 100
        return forward(observation)

    monkeypatch.setattr(model, "forward", mutate)
    np.testing.assert_allclose(model.predict_action(x), expected)
    same(before, snapshot(owner))


def test_later_failed_batch_retains_accepted_first_batch(monkeypatch):
    owner = trainer()
    step = owner.bc_optimizer.step
    accepted = []
    monkeypatch.setattr(np.random, "permutation", lambda n: np.arange(n))

    def fail_second(*args, **kwargs):
        step(*args, **kwargs)
        if accepted:
            raise RuntimeError("second batch")
        accepted.append(snapshot(owner))

    monkeypatch.setattr(owner.bc_optimizer, "step", fail_second)
    with pytest.raises(RuntimeError):
        owner.train_behavioral_cloning(*batch(), epochs=1, batch_size=1)
    same(accepted[0], snapshot(owner))


def test_native_inflight_update_fences_prediction(monkeypatch):
    owner = trainer()
    entered, release, started = threading.Event(), threading.Event(), threading.Event()
    step = owner.bc_optimizer.step

    def blocked(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        return step(*args, **kwargs)

    def prediction():
        started.set()
        return owner.behavioral_cloning.predict_action(batch()[0])

    monkeypatch.setattr(owner.bc_optimizer, "step", blocked)
    with ThreadPoolExecutor(2) as pool:
        fitting = pool.submit(owner.train_behavioral_cloning, *batch(), epochs=1)
        assert entered.wait(5)
        predicting = pool.submit(prediction)
        assert started.wait(5)
        try:
            assert not predicting.done()
        finally:
            release.set()
        assert np.isfinite(fitting.result()["losses"]).all()
        assert np.isfinite(predicting.result()).all()


def test_native_copy_has_independent_lock_and_registered_bindings():
    owner = trainer()
    clone = copy.deepcopy(owner)
    assert (
        clone.behavioral_cloning._operation_lock
        is not owner.behavioral_cloning._operation_lock
    )
    assert all(
        a is b
        for a, b in zip(
            clone.behavioral_cloning.parameters(),
            clone.bc_optimizer.param_groups[0]["params"],
        )
    )
    assert np.isfinite(
        clone.train_behavioral_cloning(*batch(), epochs=1)["losses"]
    ).all()


@pytest.mark.parametrize(
    "fault",
    [
        "negative_variance",
        "fractional_step",
        "foreign_binding",
        "nonfinite_weight",
        "nonfinite_lr",
        "fused",
    ],
)
def test_invalid_prior_native_state_rejected_without_rng(fault, monkeypatch):
    owner = trainer()
    owner.train_behavioral_cloning(*batch(), epochs=1)
    optimizer = owner.bc_optimizer
    p = next(owner.behavioral_cloning.parameters())
    if fault == "negative_variance":
        optimizer.state[p]["exp_avg_sq"].fill_(-1)
    elif fault == "fractional_step":
        optimizer.state[p]["step"].fill_(0.5)
    elif fault == "foreign_binding":
        foreign = torch.nn.Parameter(p.detach().clone())
        optimizer.param_groups[0]["params"][0] = foreign
        optimizer.state[foreign] = optimizer.state.pop(p)
    elif fault == "nonfinite_weight":
        with torch.no_grad():
            p.fill_(float("inf"))
    elif fault == "nonfinite_lr":
        optimizer.param_groups[0]["lr"] = float("inf")
    else:
        optimizer.param_groups[0]["fused"] = True
    before = snapshot(owner)
    monkeypatch.setattr(
        np.random, "permutation", lambda n: pytest.fail("RNG before admission")
    )
    with pytest.raises(ValueError):
        owner.train_behavioral_cloning(*batch(), epochs=1)
    same(before, snapshot(owner))


@pytest.mark.parametrize("dtype", [torch.float32, torch.float64])
def test_short_batch_epoch_loss_is_row_weighted(dtype, monkeypatch):
    owner = trainer(dtype)
    reference = copy.deepcopy(owner)
    x, y = batch()
    monkeypatch.setattr(np.random, "permutation", lambda n: np.arange(n))
    first = reference.train_behavioral_cloning(x[:2], y[:2], epochs=1)["losses"][0]
    last = reference.train_behavioral_cloning(x[2:], y[2:], epochs=1)["losses"][0]
    actual = owner.train_behavioral_cloning(x, y, epochs=1, batch_size=2)["losses"][0]
    assert actual == pytest.approx((2 * first + last) / 3)
    same(
        owner.behavioral_cloning.state_dict(), reference.behavioral_cloning.state_dict()
    )
    same(owner.bc_optimizer.state_dict(), reference.bc_optimizer.state_dict())
