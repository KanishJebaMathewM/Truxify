"""Native model/Adam/plateau continuation, tuple recovery and operation ownership."""

import copy
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
import torch
from pinns.checkpoint_state import capture_state, restore_state
from pinns.model import PhysicsInformedNN, PhysicsLoss, PINNTrainer

KINDS = ["diffusion", "advection", "burger", "poisson"]


def trainer(kind="diffusion", dtype=torch.float32, seed=13):
    torch.manual_seed(seed)
    model = PhysicsInformedNN(2, 4, 1, 1).to(dtype=dtype)
    return PINNTrainer(model, PhysicsLoss(kind), device="cpu")


def advance(owner):
    dtype = next(owner.model.parameters()).dtype
    x = torch.tensor([[0.2, 0.1], [0.4, 0.3]], dtype=dtype)
    y = torch.tensor([[0.3], [0.1]], dtype=dtype)
    kwargs = (
        {"f": torch.tensor([[0.2], [-0.1]], dtype=dtype)}
        if owner.physics_loss.physics_type == "poisson"
        else {}
    )
    return owner.train_step(x, y, x + 0.1, **kwargs)


def warm(owner):
    advance(owner)
    owner.scheduler.patience = 0
    owner.scheduler.step(1.0)
    owner.scheduler.step(2.0)


def snapshot(owner):
    return (
        copy.deepcopy(owner.model.state_dict()),
        copy.deepcopy(owner.optimizer.state_dict()),
        copy.deepcopy(owner.scheduler.state_dict()),
        [None if p.grad is None else p.grad.clone() for p in owner.model.parameters()],
        [m.training for m in owner.model.modules()],
        [id(p) for p in owner.model.parameters()],
        id(owner.model),
        id(owner.optimizer),
        id(owner.scheduler),
        id(owner.scheduler.optimizer),
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


@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("dtype", [torch.float32, torch.float64])
def test_actual_native_pde_adam_and_plateau_next_update_roundtrip(
    kind, dtype, tmp_path
):
    source, target = trainer(kind, dtype), trainer(kind, dtype, seed=71)
    warm(source)
    path = tmp_path / "native.pth"
    source.save(str(path))
    before = snapshot(target)
    target.load(str(path))
    same_tree(source.model.state_dict(), target.model.state_dict())
    same_tree(source.optimizer.state_dict(), target.optimizer.state_dict())
    same_tree(source.scheduler.state_dict(), target.scheduler.state_dict())
    assert snapshot(target)[5:] == before[5:]
    assert advance(target) == advance(source)
    # Independent native plateau rule: patience0, bad metric -> factor0.5.
    expected_lr = source.optimizer.param_groups[0]["lr"] * 0.5
    source.scheduler.step(2.0)
    target.scheduler.step(2.0)
    assert (
        source.optimizer.param_groups[0]["lr"]
        == target.optimizer.param_groups[0]["lr"]
        == expected_lr
    )
    same_tree(source.optimizer.state_dict(), target.optimizer.state_dict())
    same_tree(source.scheduler.state_dict(), target.scheduler.state_dict())


@pytest.mark.parametrize("kind", KINDS)
def test_legacy_weights_adam_file_starts_explicit_fresh_scheduler(kind):
    source, target = trainer(kind), trainer(kind, seed=71)
    warm(source)
    target.scheduler.patience = 4
    target.scheduler.step(3.0)
    payload = capture_state(source)
    payload.pop("scheduler_state_dict")
    payload.pop("pinn_config")
    restore_state(target, payload)
    assert target.scheduler.optimizer is target.optimizer
    assert target.scheduler.patience == 4
    assert target.scheduler.last_epoch == 0 and target.scheduler.best == float("inf")
    assert target.scheduler.num_bad_epochs == target.scheduler.cooldown_counter == 0
    assert target.scheduler.get_last_lr() == [source.optimizer.param_groups[0]["lr"]]
    target.scheduler.step(2.0)
    assert (
        target.optimizer.param_groups[0]["lr"] == source.optimizer.param_groups[0]["lr"]
    )


@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize(
    "fault",
    [
        "late_key",
        "late_shape",
        "nan_weight",
        "groups",
        "order",
        "moment_shape",
        "negative_variance",
        "fractional_step",
        "extra_state",
        "nan_policy",
        "metadata",
        "scheduler_missing",
        "scheduler_lr",
        "scheduler_best",
        "scheduler_count",
        "scheduler_factor",
        "scheduler_mode",
        "scheduler_min_lr",
        "scheduler_cooldown",
        "scheduler_sentinel",
    ],
)
def test_complete_late_native_tuple_rejection_preserves_state_and_retry(kind, fault):
    source, target = trainer(kind), trainer(kind, seed=71)
    warm(source)
    warm(target)
    target.model.eval()
    next(iter(target.model.children())).train()
    payload = capture_state(source)
    weights, adam, schedule = (
        payload[key]
        for key in ("model_state_dict", "optimizer_state_dict", "scheduler_state_dict")
    )
    first = next(iter(adam["state"].values()))
    if fault == "late_key":
        weights.pop(list(weights)[-1])
    elif fault == "late_shape":
        weights[list(weights)[-1]] = torch.ones(1, 99)
    elif fault == "nan_weight":
        weights[list(weights)[-1]].flatten()[0] = float("nan")
    elif fault == "groups":
        adam["param_groups"] = []
    elif fault == "order":
        adam["param_groups"][0]["params"].reverse()
    elif fault == "moment_shape":
        first["exp_avg_sq"] = torch.ones(1)
    elif fault == "negative_variance":
        first["exp_avg_sq"].fill_(-1)
    elif fault == "fractional_step":
        first["step"] = torch.tensor(1.5)
    elif fault == "extra_state":
        adam["state"][999] = first
    elif fault == "nan_policy":
        adam["param_groups"][0]["lr"] = float("nan")
    elif fault == "metadata":
        payload["pinn_config"]["objective"]["physics_type"] = "other"
    elif fault == "scheduler_missing":
        schedule.pop("best")
    elif fault == "scheduler_lr":
        schedule["_last_lr"] = [123.0]
    elif fault == "scheduler_best":
        schedule["best"] = float("nan")
    elif fault == "scheduler_count":
        schedule["last_epoch"] = True
    elif fault == "scheduler_factor":
        schedule["factor"] = 1.0
    elif fault == "scheduler_mode":
        schedule["threshold_mode"] = "other"
    elif fault == "scheduler_min_lr":
        schedule["min_lrs"] = [-1.0]
    elif fault == "scheduler_cooldown":
        schedule["cooldown_counter"] = 3
    elif fault == "scheduler_sentinel":
        schedule["mode_worse"] = -float("inf")
    before, rng = snapshot(target), torch.get_rng_state().clone()
    with pytest.raises((ValueError, TypeError, RuntimeError)):
        restore_state(target, payload)
    same_tree(before, snapshot(target))
    torch.testing.assert_close(rng, torch.get_rng_state())
    restore_state(target, capture_state(source))
    assert advance(target) == advance(source)


@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("dtype", [torch.float32, torch.float64])
def test_native_amsgrad_and_max_mode_cooldown_scheduler_continuation(kind, dtype):
    source, target = trainer(kind, dtype), trainer(kind, dtype, seed=71)
    source.optimizer = torch.optim.Adam(
        source.model.parameters(), lr=0.001, amsgrad=True
    )
    source.scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        source.optimizer,
        mode="max",
        factor=0.3,
        patience=0,
        cooldown=2,
        threshold_mode="abs",
        min_lr=0.00001,
    )
    advance(source)
    source.scheduler.step(3.0)
    source.scheduler.step(2.0)
    restore_state(target, capture_state(source))
    for metric in (2.0, 2.0, 2.0, 4.0, 1.0):
        source.scheduler.step(metric)
        target.scheduler.step(metric)
        same_tree(source.scheduler.state_dict(), target.scheduler.state_dict())
        same_tree(source.optimizer.state_dict(), target.optimizer.state_dict())
    assert advance(target) == advance(source)


@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("fault", ["optimizer", "scheduler"])
def test_ordinary_partial_native_publication_restores_complete_tuple(
    kind, fault, monkeypatch
):
    source, target = trainer(kind), trainer(kind, seed=71)
    warm(source)
    warm(target)
    target.model.eval()
    before = snapshot(target)
    component = getattr(target, fault)
    original = type(component).load_state_dict

    def partial(instance, state):
        original(instance, state)
        if instance is component:
            raise RuntimeError("after native publication")

    monkeypatch.setattr(type(component), "load_state_dict", partial)
    with pytest.raises(RuntimeError, match="native publication"):
        restore_state(target, capture_state(source))
    same_tree(before, snapshot(target))
    monkeypatch.setattr(type(component), "load_state_dict", original)
    restore_state(target, capture_state(source))
    assert advance(target) == advance(source)


@pytest.mark.parametrize("kind", KINDS)
def test_capture_independently_owns_model_moments_and_scheduler(kind):
    owner = trainer(kind)
    warm(owner)
    captured = capture_state(owner)
    expected = copy.deepcopy(captured)
    advance(owner)
    owner.scheduler.step(3.0)
    same_tree(expected, captured)
    captured["scheduler_state_dict"]["_last_lr"][0] = 99
    assert owner.scheduler.get_last_lr()[0] != 99


@pytest.mark.parametrize("kind", KINDS)
def test_owned_input_survives_caller_mutation_during_native_publication(
    kind, monkeypatch
):
    source, target = trainer(kind), trainer(kind, seed=71)
    warm(source)
    payload = capture_state(source)
    expected = copy.deepcopy(payload)
    original = target.model.load_state_dict

    def mutate(state, *args, **kwargs):
        for value in payload["model_state_dict"].values():
            value.zero_()
        payload["optimizer_state_dict"]["param_groups"][0]["lr"] = 99
        payload["scheduler_state_dict"]["best"] = 99
        return original(state, *args, **kwargs)

    monkeypatch.setattr(target.model, "load_state_dict", mutate)
    restore_state(target, payload)
    same_tree(expected["model_state_dict"], target.model.state_dict())
    same_tree(expected["optimizer_state_dict"], target.optimizer.state_dict())
    same_tree(expected["scheduler_state_dict"], target.scheduler.state_dict())


@pytest.mark.parametrize("kind", KINDS)
def test_valid_tuple_repairs_corrupt_old_numeric_state(kind):
    source, target = trainer(kind), trainer(kind, seed=71)
    warm(source)
    warm(target)
    with torch.no_grad():
        next(target.model.parameters()).fill_(float("nan"))
    next(iter(target.optimizer.state.values()))["exp_avg"].fill_(float("nan"))
    target.scheduler.best = float("nan")
    restore_state(target, capture_state(source))
    assert advance(target) == advance(source)


@pytest.mark.parametrize("operation", ["save", "load"])
def test_native_checkpoint_waits_for_admitted_pde_update(operation, tmp_path):
    owner = trainer()
    path = tmp_path / "native.pth"
    owner.save(str(path))
    entered, release, started, finished = (threading.Event() for _ in range(4))
    original = owner.optimizer.step

    def paused(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        return original(*args, **kwargs)

    owner.optimizer.step = paused

    def checkpoint():
        started.set()
        getattr(owner, operation)(str(path))
        finished.set()

    with ThreadPoolExecutor(2) as pool:
        fitting = pool.submit(advance, owner)
        assert entered.wait(5)
        checking = pool.submit(checkpoint)
        assert started.wait(5)
        assert not finished.wait(0.05)
        release.set()
        fitting.result(5)
        checking.result(5)
    assert finished.is_set()


def test_native_copy_rebinds_scheduler_optimizer_with_independent_lock():
    owner = trainer()
    warm(owner)
    cloned = copy.deepcopy(owner)
    assert cloned._operation_lock is not owner._operation_lock
    assert cloned.scheduler.optimizer is cloned.optimizer
    assert cloned.optimizer is not owner.optimizer
    assert advance(cloned) == advance(owner)


@pytest.mark.parametrize("fault", ["optimizer_binding", "scheduler_binding"])
def test_capture_rejects_foreign_live_component_binding(fault):
    owner, other = trainer(), trainer(seed=71)
    if fault == "optimizer_binding":
        owner.optimizer = other.optimizer
        owner.scheduler.optimizer = owner.optimizer
    else:
        owner.scheduler.optimizer = other.optimizer
    before = snapshot(owner)
    with pytest.raises(ValueError):
        capture_state(owner)
    same_tree(before, snapshot(owner))
