"""Real lazy denoiser/AdamW continuation, malformed pairs and publication recovery."""

import copy
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
import torch
from diffusion.checkpoint_state import capture_checkpoint, restore_checkpoint
from diffusion.model import DiffusionRouteModel
from diffusion.trainer import DiffusionTrainer
from torch.nn.parameter import UninitializedParameter


def native(dtype=torch.float32, amsgrad=False):
    torch.manual_seed(27)
    model = DiffusionRouteModel(
        input_dim=2, hidden_dim=8, num_layers=1, num_heads=2, num_timesteps=4
    )
    model.to(dtype=dtype)
    owner = DiffusionTrainer(model, device="cpu")
    owner.optimizer = torch.optim.AdamW(model.parameters(), lr=0.001, amsgrad=amsgrad)
    return owner


def data(dtype=torch.float32):
    return torch.linspace(-0.3, 0.5, 12, dtype=dtype).reshape(2, 3, 2), torch.ones(
        2, 3, 3, dtype=dtype
    )


def step(owner, conditional):
    x, c = data(next(owner.model.parameters()).dtype)
    return owner.train_step(x, c if conditional else None)


def equal(a, b):
    if isinstance(a, torch.Tensor):
        assert a.dtype == b.dtype and a.shape == b.shape
        torch.testing.assert_close(a, b, rtol=0, atol=0, equal_nan=True)
    elif isinstance(a, dict):
        assert a.keys() == b.keys()
        for key in a:
            equal(a[key], b[key])
    elif isinstance(a, (list, tuple)):
        assert len(a) == len(b)
        for x, y in zip(a, b):
            equal(x, y)
    else:
        assert a == b


def snapshot(owner):
    state = {
        k: {"lazy": True, "dtype": v.dtype, "device": v.device}
        if isinstance(v, UninitializedParameter)
        else v.detach().clone()
        for k, v in owner.model.state_dict().items()
    }
    return copy.deepcopy(
        (
            state,
            owner.optimizer.state_dict(),
            owner.train_losses,
            owner.val_losses,
            [p.grad for p in owner.model.parameters()],
            [m.training for m in owner.model.modules()],
        )
    )


def write(tmp_path, payload):
    path = tmp_path / "native.pth"
    torch.save(payload, path)
    return path


@pytest.mark.parametrize("dtype", [torch.float32, torch.float64])
@pytest.mark.parametrize("conditional", [False, True])
@pytest.mark.parametrize("initialized", [False, True])
@pytest.mark.parametrize("amsgrad", [False, True])
def test_native_checkpoint_roundtrip_and_independent_next_step(
    tmp_path, dtype, conditional, initialized, amsgrad
):
    source = native(dtype, amsgrad)
    if initialized:
        step(source, conditional)
    source.train_losses = [0.3, 0.2]
    source.val_losses = [0.25]
    source.save_checkpoint(tmp_path / "roundtrip.pth")
    # Ordinary loading policy: fresh lazy files consist only of tensors/plain data.
    payload = torch.load(tmp_path / "roundtrip.pth", weights_only=True)
    target = native(dtype)
    identities = [id(p) for p in target.model.parameters()]
    target.load_checkpoint(tmp_path / "roundtrip.pth")
    equal(capture_checkpoint(target), capture_checkpoint(source))
    assert identities == [id(p) for p in target.model.parameters()]
    reference = copy.deepcopy(source.model)
    opt = torch.optim.AdamW(reference.parameters(), lr=0.001)
    opt.load_state_dict(copy.deepcopy(source.optimizer.state_dict()))
    x, c = data(dtype)
    rng = torch.get_rng_state()
    reference.train()
    opt.zero_grad()
    if conditional and isinstance(reference.cond_proj.weight, UninitializedParameter):
        # Upstream now materializes an admitted condition before timestep/noise
        # draws. Use the actual native initializer, independently of trainer code.
        reference.cond_proj.initialize_parameters(c)
    t = torch.randint(0, reference.num_timesteps, (len(x),))
    noise = torch.randn_like(x)
    noisy = reference.add_noise(x, t, noise)
    if conditional:
        noisy = torch.cat([noisy, c], dim=-1)
    loss = torch.nn.functional.mse_loss(reference.denoise(noisy, t), noise)
    loss.backward()
    torch.nn.utils.clip_grad_norm_(reference.parameters(), 1.0)
    opt.step()
    torch.set_rng_state(rng)
    assert step(target, conditional) == loss.item()
    # Native first LazyLinear initialization has used the same owned RNG sequence.
    for name, value in reference.state_dict().items():
        other = target.model.state_dict()[name]
        if isinstance(value, UninitializedParameter):
            assert isinstance(other, UninitializedParameter)
        else:
            equal(value, other)
    equal(opt.state_dict(), target.optimizer.state_dict())
    assert payload["train_losses"] is not target.train_losses


BAD = [
    "late_key",
    "extra_key",
    "shape",
    "model_nan",
    "model_cast_overflow",
    "bad_lazy_marker",
    "partial_lazy",
    "groups",
    "reordered",
    "moment_shape",
    "complex_moment",
    "negative_variance",
    "negative_underflow",
    "moment_cast_overflow",
    "negative_step",
    "fractional_step",
    "missing_moment",
    "bad_policy",
    "beta_range",
    "alpha_range",
    "bars_range",
    "alpha_relation",
    "bars_relation",
    "schedule_nan",
    "missing_train",
    "nan_train",
    "negative_val",
    "bad_history_type",
    "missing_optimizer",
    "amsgrad_max",
]


def damage(payload, kind):
    state = payload["model_state_dict"]
    opt = payload["optimizer_state_dict"]
    for name, value in state.items():
        if name not in ("betas", "alphas", "alpha_bars") and isinstance(
            value, torch.Tensor
        ):
            value.add_(0.1)
    moment = next(iter(opt["state"].values()))
    key = list(state)[-1]
    if kind == "late_key":
        del state[key]
    elif kind == "extra_key":
        state["foreign"] = torch.ones(1)
    elif kind == "shape":
        state[key] = torch.ones(1)
    elif kind == "model_nan":
        state[key].flatten()[0] = float("nan")
    elif kind == "model_cast_overflow":
        state[key] = torch.full(state[key].shape, 1e100, dtype=torch.float64)
    elif kind == "bad_lazy_marker":
        state["cond_proj.weight"] = {"deferred_condition_parameter": False}
    elif kind == "partial_lazy":
        state["cond_proj.weight"] = {"deferred_condition_parameter": True}
    elif kind == "groups":
        opt["param_groups"] = []
    elif kind == "reordered":
        opt["param_groups"][0]["params"].reverse()
    elif kind == "moment_shape":
        moment["exp_avg_sq"] = torch.zeros(1)
    elif kind == "complex_moment":
        moment["exp_avg"] = moment["exp_avg"].to(torch.complex64)
    elif kind == "negative_variance":
        moment["exp_avg_sq"].flatten()[0] = -1
    elif kind == "negative_underflow":
        moment["exp_avg_sq"] = moment["exp_avg_sq"].double()
        moment["exp_avg_sq"].flatten()[0] = -1e-100
    elif kind == "moment_cast_overflow":
        moment["exp_avg"] = torch.full(
            moment["exp_avg"].shape, 1e100, dtype=torch.float64
        )
    elif kind == "negative_step":
        moment["step"] = torch.tensor(-1.0)
    elif kind == "fractional_step":
        moment["step"] = torch.tensor(0.5)
    elif kind == "missing_moment":
        del moment["exp_avg"]
    elif kind == "bad_policy":
        opt["param_groups"][0]["lr"] = float("nan")
    elif kind == "beta_range":
        state["betas"].fill_(1.0)
    elif kind == "alpha_range":
        state["alphas"].fill_(-1.0)
    elif kind == "bars_range":
        state["alpha_bars"].fill_(2.0)
    elif kind == "alpha_relation":
        state["alphas"].fill_(0.5)
    elif kind == "bars_relation":
        state["alpha_bars"].fill_(0.5)
    elif kind == "schedule_nan":
        state["betas"][0] = float("nan")
    elif kind == "missing_train":
        del payload["train_losses"]
    elif kind == "nan_train":
        payload["train_losses"] = [float("nan")]
    elif kind == "negative_val":
        payload["val_losses"] = [-1.0]
    elif kind == "bad_history_type":
        payload["train_losses"] = {"fabricated": 0.1}
    elif kind == "missing_optimizer":
        del payload["optimizer_state_dict"]
    elif kind == "amsgrad_max":
        moment["max_exp_avg_sq"] = torch.zeros_like(moment["exp_avg_sq"])
    else:
        raise AssertionError(kind)


@pytest.mark.parametrize("kind", BAD)
def test_invalid_complete_pair_retains_every_prior_component(tmp_path, kind):
    source = native(amsgrad=True)
    step(source, True)
    payload = capture_checkpoint(source)
    damage(payload, kind)
    target = native()
    step(target, True)
    target.train_losses = [0.6]
    target.val_losses = [0.7]
    target.model.eval()
    target.model.blocks[0].train()
    before = snapshot(target)
    ids = [id(p) for p in target.model.parameters()]
    with pytest.raises((ValueError, RuntimeError, TypeError)):
        target.load_checkpoint(write(tmp_path, payload))
    equal(snapshot(target), before)
    assert ids == [id(p) for p in target.model.parameters()]
    target.load_checkpoint(write(tmp_path, capture_checkpoint(source)))
    equal(capture_checkpoint(target), capture_checkpoint(source))


@pytest.mark.parametrize("phase", ["model", "optimizer"])
@pytest.mark.parametrize("old_lazy", [False, True])
def test_native_partial_publication_recovers_lazy_identity_and_retries(
    tmp_path, monkeypatch, phase, old_lazy
):
    target = native()
    if not old_lazy:
        step(target, True)
    else:
        step(target, False)
    target.model.eval()
    target.model.blocks[0].train()
    before = snapshot(target)
    ids = [id(p) for p in target.model.parameters()]
    source = native()
    step(source, True)
    path = write(tmp_path, capture_checkpoint(source))
    if phase == "optimizer":
        original = target.optimizer.load_state_dict

        def broken(value):
            original(value)
            target.model.train()
            raise RuntimeError("native publication fault")

        monkeypatch.setattr(target.optimizer, "load_state_dict", broken)
    else:
        cls = type(target.model)
        original = cls.load_state_dict

        def broken(self, *args, **kwargs):
            result = original(self, *args, **kwargs)
            if self is target.model:
                self.train()
                raise RuntimeError("native publication fault")
            return result

        monkeypatch.setattr(cls, "load_state_dict", broken)
    with pytest.raises(RuntimeError, match="publication fault"):
        target.load_checkpoint(path)
    equal(snapshot(target), before)
    assert ids == [id(p) for p in target.model.parameters()]
    if old_lazy:
        assert isinstance(target.model.cond_proj.weight, UninitializedParameter)
    monkeypatch.undo()
    target.load_checkpoint(path)
    assert ids == [id(p) for p in target.model.parameters()]
    equal(capture_checkpoint(target), capture_checkpoint(source))
    assert torch.isfinite(torch.tensor(step(target, True)))
    assert target.model.cond_proj.in_features == 3


def test_fresh_lazy_checkpoint_does_not_reset_materialized_schema(tmp_path):
    source = native()
    target = native()
    step(target, True)
    before = snapshot(target)
    with pytest.raises(ValueError):
        target.load_checkpoint(write(tmp_path, capture_checkpoint(source)))
    equal(snapshot(target), before)


@pytest.mark.parametrize(
    "source_dtype,target_dtype",
    [(torch.float32, torch.float64), (torch.float64, torch.float32)],
)
def test_native_cross_dtype_checkpoint_conversion(tmp_path, source_dtype, target_dtype):
    source = native(source_dtype)
    step(source, True)
    payload = capture_checkpoint(source)
    target = native(target_dtype)
    target.load_checkpoint(write(tmp_path, payload))
    reference = native(target_dtype)
    reference.model.load_state_dict(payload["model_state_dict"])
    reference.optimizer.load_state_dict(payload["optimizer_state_dict"])
    rng = torch.get_rng_state()
    expected = step(reference, True)
    torch.set_rng_state(rng)
    assert step(target, True) == expected
    equal(target.model.state_dict(), reference.model.state_dict())
    equal(target.optimizer.state_dict(), reference.optimizer.state_dict())


def test_legacy_materialized_format_and_corrupt_old_repair(tmp_path):
    source = native()
    step(source, True)
    payload = {
        "model_state_dict": copy.deepcopy(source.model.state_dict()),
        "optimizer_state_dict": copy.deepcopy(source.optimizer.state_dict()),
        "train_losses": [0.1],
        "val_losses": [],
    }
    target = native()
    step(target, True)
    with torch.no_grad():
        next(target.model.parameters()).fill_(float("nan"))
    target.train_losses = [float("nan")]
    target.load_checkpoint(write(tmp_path, payload))
    assert torch.isfinite(torch.tensor(step(target, True)))
    assert target.train_losses == [0.1]


def test_complete_candidate_owns_incoming_histories_weights_and_moments(monkeypatch):
    source = native()
    step(source, True)
    source.train_losses = [0.2]
    payload = capture_checkpoint(source)
    target = native()
    expected = copy.deepcopy(payload)
    original = target.optimizer.load_state_dict

    def mutate(value):
        for tensor in payload["model_state_dict"].values():
            tensor.zero_()
        payload["train_losses"].append(999)
        next(iter(payload["optimizer_state_dict"]["state"].values()))["exp_avg"].zero_()
        return original(value)

    monkeypatch.setattr(target.optimizer, "load_state_dict", mutate)
    restore_checkpoint(target, payload)
    equal(capture_checkpoint(target), expected)


def test_training_and_save_wait_for_complete_checkpoint_publication(
    tmp_path, monkeypatch
):
    source = native()
    step(source, True)
    path = write(tmp_path, capture_checkpoint(source))
    target = native()
    entered = threading.Event()
    release = threading.Event()
    original = target.optimizer.load_state_dict

    def pause(value):
        entered.set()
        assert release.wait(5)
        return original(value)

    monkeypatch.setattr(target.optimizer, "load_state_dict", pause)
    with ThreadPoolExecutor(max_workers=3) as pool:
        load = pool.submit(target.load_checkpoint, path)
        assert entered.wait(5)
        save = pool.submit(target.save_checkpoint, tmp_path / "after.pth")
        fit = pool.submit(step, target, True)
        assert not save.done() and not fit.done()
        release.set()
        load.result(5)
        save.result(5)
        fit.result(5)
    assert torch.isfinite(torch.tensor(step(target, True)))
