"""Actual SSL checkpoint tuple admission, next-native-update and ownership."""

import copy
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
import torch
from self_supervised.checkpoint_pair import capture_pair, restore_pair
from self_supervised.model import MaskedAutoencoder, MoCo, SimCLR, SSLPreTrainer

FAMILIES = ["simclr", "moco", "mae"]


def trainer(family, dtype=torch.float32, seed=13):
    torch.manual_seed(seed)
    model = (
        SimCLR(2, 4, 2)
        if family == "simclr"
        else MoCo(2, 4, 2, queue_size=3, momentum=0.5)
        if family == "moco"
        else MaskedAutoencoder(2, 4, mask_ratio=1)
    )
    model.to(dtype=dtype)
    return SSLPreTrainer(model, device="cpu")


def advance(owner):
    dtype = next(owner.model.parameters()).dtype
    rows = torch.tensor([[0.1, -0.3], [0.4, 0.2]], dtype=dtype)
    owner.model.train()
    if isinstance(owner.model, MoCo):
        loss = owner.model(rows, rows.flip(0))
    elif isinstance(owner.model, SimCLR):
        _, left = owner.model(rows)
        _, right = owner.model(rows.flip(0))
        loss = owner.model.contrastive_loss(left, right)
    else:
        _, loss, _ = owner.model(rows[:, None, :])
    owner.optimizer.zero_grad()
    loss.backward()
    torch.nn.utils.clip_grad_norm_(
        owner.model.parameters(), 1.0, error_if_nonfinite=True
    )
    owner.optimizer.step()
    return float(loss.item())


def snapshot(owner):
    return (
        copy.deepcopy(owner.model.state_dict()),
        copy.deepcopy(owner.optimizer.state_dict()),
        [None if p.grad is None else p.grad.clone() for p in owner.model.parameters()],
        [m.training for m in owner.model.modules()],
        [id(p) for p in owner.model.parameters()],
        [id(b) for b in owner.model.buffers()],
        id(owner.optimizer),
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


@pytest.mark.parametrize("family", FAMILIES)
@pytest.mark.parametrize("dtype", [torch.float32, torch.float64])
@pytest.mark.parametrize("legacy", [False, True])
def test_actual_paired_roundtrip_and_next_native_update(
    family, dtype, legacy, tmp_path
):
    source, target = trainer(family, dtype), trainer(family, dtype, seed=71)
    advance(source)
    path = tmp_path / "actual.pth"
    source.save(str(path))
    payload = torch.load(path, weights_only=True)
    if legacy:
        payload.pop("ssl_config")
        torch.save(payload, path)
    old = snapshot(target)
    target.load(str(path))
    same_tree(source.model.state_dict(), target.model.state_dict())
    same_tree(source.optimizer.state_dict(), target.optimizer.state_dict())
    assert snapshot(target)[4:] == old[4:]
    torch.manual_seed(41)
    expected = advance(source)
    torch.manual_seed(41)
    assert advance(target) == expected
    same_tree(source.model.state_dict(), target.model.state_dict())
    same_tree(source.optimizer.state_dict(), target.optimizer.state_dict())
    if family == "moco":
        assert all(not p.requires_grad for p in target.model.key_encoder.parameters())
        assert all(p.grad is None for p in target.model.key_encoder.parameters())


@pytest.mark.parametrize("family", FAMILIES)
@pytest.mark.parametrize(
    "fault",
    [
        "late_key",
        "late_shape",
        "nan_weight",
        "groups",
        "order",
        "missing_moment",
        "shape_moment",
        "negative_variance",
        "fractional_step",
        "extra_state",
        "nan_policy",
        "zero_eps",
        "fused",
        "metadata",
        "version",
    ],
)
def test_complete_late_candidate_rejection_preserves_prior_native_state(family, fault):
    source, target = trainer(family), trainer(family, seed=71)
    advance(source)
    advance(target)
    target.model.eval()
    next(iter(target.model.children())).train()
    payload = capture_pair(source.model, source.optimizer)
    weights, native = payload["model_state_dict"], payload["optimizer_state_dict"]
    first = next(iter(native["state"].values()))
    if fault == "late_key":
        weights.pop(list(weights)[-1])
    elif fault == "late_shape":
        weights[list(weights)[-1]] = torch.ones(1, 99)
    elif fault == "nan_weight":
        weights[list(weights)[-1]].flatten()[0] = float("nan")
    elif fault == "groups":
        native["param_groups"] = []
    elif fault == "order":
        native["param_groups"][0]["params"].reverse()
    elif fault == "missing_moment":
        first.pop("exp_avg")
    elif fault == "shape_moment":
        first["exp_avg_sq"] = torch.ones(1)
    elif fault == "negative_variance":
        first["exp_avg_sq"].fill_(-1)
    elif fault == "fractional_step":
        first["step"] = torch.tensor(1.5)
    elif fault == "extra_state":
        native["state"][999] = copy.deepcopy(first)
    elif fault == "nan_policy":
        native["param_groups"][0]["lr"] = float("nan")
    elif fault == "zero_eps":
        native["param_groups"][0]["eps"] = 0
    elif fault == "fused":
        native["param_groups"][0]["fused"] = True
    elif fault == "metadata":
        payload["ssl_config"]["model"]["hidden_dim"] = 99
    elif fault == "version":
        payload["ssl_config"]["version"] = True
    before, rng = snapshot(target), torch.get_rng_state().clone()
    with pytest.raises((ValueError, TypeError, RuntimeError)):
        restore_pair(target.model, target.optimizer, payload)
    same_tree(before, snapshot(target))
    torch.testing.assert_close(rng, torch.get_rng_state())
    restore_pair(
        target.model, target.optimizer, capture_pair(source.model, source.optimizer)
    )
    assert advance(target) == pytest.approx(advance(source))


@pytest.mark.parametrize(
    "fault",
    ["fractional", "negative", "capacity", "wrong_dtype", "oversized_key", "nan_key"],
)
def test_moco_dictionary_pointer_source_semantics_before_native_cast(fault):
    source, target = trainer("moco"), trainer("moco", seed=71)
    payload = capture_pair(source.model, source.optimizer)
    state = payload["model_state_dict"]
    if fault == "fractional":
        state["queue_ptr"] = torch.tensor([1.5])
    elif fault == "negative":
        state["queue_ptr"] = torch.tensor([-1])
    elif fault == "capacity":
        state["queue_ptr"] = torch.tensor([3])
    elif fault == "wrong_dtype":
        state["queue_ptr"] = torch.tensor([1], dtype=torch.int32)
    elif fault == "oversized_key":
        state["queue"].fill_(2)
    else:
        state["queue"][0, -1] = float("nan")
    before = snapshot(target)
    with pytest.raises(ValueError):
        restore_pair(target.model, target.optimizer, payload)
    same_tree(before, snapshot(target))


@pytest.mark.parametrize("family", FAMILIES)
@pytest.mark.parametrize("kind", ["weight", "moment"])
def test_post_native_cast_overflow_rejects_without_publication(family, kind):
    source, target = trainer(family, torch.float64), trainer(family)
    advance(source)
    payload = capture_pair(source.model, source.optimizer)
    if kind == "weight":
        payload["model_state_dict"][next(iter(payload["model_state_dict"]))].flatten()[
            0
        ] = 1e100
    else:
        next(iter(payload["optimizer_state_dict"]["state"].values()))[
            "exp_avg"
        ].flatten()[0] = 1e100
    before = snapshot(target)
    with pytest.raises(ValueError):
        restore_pair(target.model, target.optimizer, payload)
    same_tree(before, snapshot(target))


@pytest.mark.parametrize("family", FAMILIES)
def test_ordinary_native_publication_failure_recovers_and_retry(family, monkeypatch):
    source, target = trainer(family), trainer(family, seed=71)
    advance(source)
    advance(target)
    target.model.eval()
    next(iter(target.model.children())).train()
    before = snapshot(target)
    original = target.optimizer.load_state_dict

    def partial(state):
        original(state)
        raise RuntimeError("after native optimizer publication")

    monkeypatch.setattr(target.optimizer, "load_state_dict", partial)
    with pytest.raises(RuntimeError, match="native optimizer"):
        restore_pair(
            target.model, target.optimizer, capture_pair(source.model, source.optimizer)
        )
    same_tree(before, snapshot(target))
    monkeypatch.setattr(target.optimizer, "load_state_dict", original)
    restore_pair(
        target.model, target.optimizer, capture_pair(source.model, source.optimizer)
    )
    same_tree(source.model.state_dict(), target.model.state_dict())


@pytest.mark.parametrize("family", FAMILIES)
def test_accepted_tuple_can_repair_corrupt_old_weights_and_moments(family):
    source, target = trainer(family), trainer(family, seed=71)
    advance(source)
    advance(target)
    with torch.no_grad():
        next(target.model.parameters()).fill_(float("nan"))
    next(iter(target.optimizer.state.values()))["exp_avg"].fill_(float("nan"))
    identities = snapshot(target)[4:]
    restore_pair(
        target.model, target.optimizer, capture_pair(source.model, source.optimizer)
    )
    assert snapshot(target)[4:] == identities
    assert torch.isfinite(next(target.model.parameters())).all()
    assert advance(target) == pytest.approx(advance(source))


@pytest.mark.parametrize("family", FAMILIES)
def test_capture_owns_model_and_native_moments(family):
    owner = trainer(family)
    advance(owner)
    captured = capture_pair(owner.model, owner.optimizer)
    before = copy.deepcopy(captured)
    advance(owner)
    same_tree(before, captured)
    for value in captured["model_state_dict"].values():
        value.zero_()
    assert any(torch.count_nonzero(v) for v in owner.model.state_dict().values())


@pytest.mark.parametrize("family", FAMILIES)
def test_restore_owns_source_before_native_publication(family, monkeypatch):
    source, target = trainer(family), trainer(family, seed=71)
    advance(source)
    payload = capture_pair(source.model, source.optimizer)
    expected = copy.deepcopy(payload)
    original = target.model.load_state_dict

    def mutate(state, *args, **kwargs):
        for value in payload["model_state_dict"].values():
            value.zero_()
        payload["optimizer_state_dict"]["param_groups"][0]["lr"] = 99
        return original(state, *args, **kwargs)

    monkeypatch.setattr(target.model, "load_state_dict", mutate)
    restore_pair(target.model, target.optimizer, payload)
    same_tree(expected["model_state_dict"], target.model.state_dict())
    same_tree(expected["optimizer_state_dict"], target.optimizer.state_dict())


@pytest.mark.parametrize("family", FAMILIES)
def test_new_configuration_identity_rejects_different_objective(family):
    source, target = trainer(family), trainer(family)
    payload = capture_pair(source.model, source.optimizer)
    if family == "mae":
        target.model.mask_ratio = 0.5
    else:
        target.model.temperature = 0.2
    before = snapshot(target)
    with pytest.raises(ValueError, match="configuration"):
        restore_pair(target.model, target.optimizer, payload)
    same_tree(before, snapshot(target))


@pytest.mark.parametrize("family", FAMILIES)
@pytest.mark.parametrize("operation", ["save", "load"])
def test_checkpoint_waits_for_inflight_native_training(family, operation, tmp_path):
    owner = trainer(family)
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

    dtype = next(owner.model.parameters()).dtype
    data = torch.ones((2, 1, 2) if family == "mae" else (2, 2), dtype=dtype)
    with ThreadPoolExecutor(2) as pool:
        fitting = pool.submit(getattr(owner, "pretrain_" + family), data, 1, 2)
        assert entered.wait(5)
        checking = pool.submit(checkpoint)
        assert started.wait(5)
        assert not finished.wait(0.05)
        release.set()
        fitting.result(5)
        checking.result(5)
    assert finished.is_set()


@pytest.mark.parametrize("family", FAMILIES)
def test_copy_has_independent_checkpoint_training_lock(family):
    owner = trainer(family)
    copied = copy.deepcopy(owner)
    assert copied._operation_lock is not owner._operation_lock
    assert advance(copied) >= 0
    assert not owner.optimizer.state


@pytest.mark.parametrize("family", FAMILIES)
@pytest.mark.parametrize("dtype", [torch.float32, torch.float64])
def test_amsgrad_complete_native_tuple_next_update(family, dtype):
    source, target = trainer(family, dtype), trainer(family, dtype, seed=71)
    source.optimizer = torch.optim.AdamW(
        source.model.parameters(), lr=1e-4, amsgrad=True
    )
    advance(source)
    restore_pair(
        target.model, target.optimizer, capture_pair(source.model, source.optimizer)
    )
    torch.manual_seed(43)
    expected = advance(source)
    torch.manual_seed(43)
    assert advance(target) == expected
    same_tree(source.optimizer.state_dict(), target.optimizer.state_dict())


@pytest.mark.parametrize("family", FAMILIES)
@pytest.mark.parametrize(
    "fault", ["missing_max", "low_max", "integer_step", "float_id", "extra_moment"]
)
def test_strict_native_moment_protocol(family, fault):
    source, target = trainer(family), trainer(family, seed=71)
    source.optimizer = torch.optim.AdamW(
        source.model.parameters(), lr=1e-4, amsgrad=True
    )
    advance(source)
    payload = capture_pair(source.model, source.optimizer)
    state = payload["optimizer_state_dict"]["state"]
    moments = next(iter(state.values()))
    if fault == "missing_max":
        moments.pop("max_exp_avg_sq")
    elif fault == "low_max":
        moments["max_exp_avg_sq"].fill_(-1)
    elif fault == "integer_step":
        moments["step"] = torch.tensor(1, dtype=torch.int64)
    elif fault == "float_id":
        state[float(next(iter(state)))] = state.pop(next(iter(state)))
    else:
        moments["custom"] = torch.tensor(1.0)
    before = snapshot(target)
    with pytest.raises(ValueError):
        restore_pair(target.model, target.optimizer, payload)
    same_tree(before, snapshot(target))


@pytest.mark.parametrize("family", FAMILIES)
def test_compatible_cross_dtype_tuple_casts_and_retains_native_next_update(family):
    source, target = trainer(family, torch.float64), trainer(family)
    advance(source)
    payload = capture_pair(source.model, source.optimizer)
    reference = trainer(family)
    # Independent ordinary Torch loading of an admitted numeric source.
    reference.model.load_state_dict(payload["model_state_dict"])
    reference.optimizer.load_state_dict(payload["optimizer_state_dict"])
    restore_pair(target.model, target.optimizer, payload)
    same_tree(reference.model.state_dict(), target.model.state_dict())
    same_tree(reference.optimizer.state_dict(), target.optimizer.state_dict())
    torch.manual_seed(59)
    expected = advance(reference)
    torch.manual_seed(59)
    assert advance(target) == expected
    same_tree(reference.model.state_dict(), target.model.state_dict())
