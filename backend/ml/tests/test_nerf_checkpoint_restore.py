"""Native checkpoint conformance, independent Adam continuation and failure controls."""

import copy
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
import torch
from nerf.checkpoint_restore import prepare_pair
from nerf.model import NeRFNetwork, NeRFRenderer, NeRFTrainer


def trainer(dtype=torch.float32, amsgrad=False):
    torch.manual_seed(38)
    model = NeRFNetwork(
        num_frequencies=1,
        num_dir_frequencies=1,
        hidden_dim=8,
        num_layers=2,
        skip_layer=1,
    ).to(dtype=dtype)
    result = NeRFTrainer(model, device="cpu")
    result.optimizer = torch.optim.Adam(model.parameters(), lr=0.002, amsgrad=amsgrad)
    return result


def observations(dtype=torch.float32):
    return (
        torch.linspace(-0.2, 0.3, 12, dtype=dtype).reshape(4, 3),
        torch.ones(4, 3, dtype=dtype),
        torch.linspace(0.1, 0.8, 12, dtype=dtype).reshape(4, 3),
    )


def checkpoint(obj):
    return copy.deepcopy(
        {
            "model_state_dict": obj.model.state_dict(),
            "optimizer_state_dict": obj.optimizer.state_dict(),
        }
    )


def equal(a, b):
    if isinstance(a, torch.Tensor):
        assert a.dtype == b.dtype and a.shape == b.shape
        torch.testing.assert_close(a, b, rtol=0, atol=0, equal_nan=True)
    elif isinstance(a, dict):
        assert a.keys() == b.keys()
        for key in a:
            equal(a[key], b[key])
    elif isinstance(a, (tuple, list)):
        assert len(a) == len(b)
        for left, right in zip(a, b):
            equal(left, right)
    else:
        assert a == b


def first_moment(payload):
    return next(iter(payload["optimizer_state_dict"]["state"].values()))


def write(tmp_path, payload):
    path = tmp_path / "native.pth"
    torch.save(payload, path)
    return path


@pytest.mark.parametrize("dtype", [torch.float32, torch.float64])
@pytest.mark.parametrize("amsgrad", [False, True])
@pytest.mark.parametrize("initialized", [False, True])
def test_native_pair_roundtrip_and_independent_next_adam(
    tmp_path, dtype, amsgrad, initialized
):
    source = trainer(dtype, amsgrad)
    data = observations(dtype)
    if initialized:
        source.train_step(*data)
    payload = checkpoint(source)
    target = trainer(dtype)
    renderer = NeRFRenderer(target.model, num_samples=3, device="cpu")
    identities = [id(p) for p in target.model.parameters()]
    target.load(write(tmp_path, payload))
    equal(checkpoint(target), payload)
    assert renderer.model is target.model
    assert identities == [id(p) for p in target.model.parameters()]
    # Independent native objective/optimizer, no call to trainer.train_step.
    source.model.train()
    source.optimizer.zero_grad()
    _, colors = source.model(data[0], data[1])
    reference_loss = torch.nn.functional.mse_loss(colors, data[2])
    reference_loss.backward()
    source.optimizer.step()
    assert target.train_step(*data) == reference_loss.item()
    equal(checkpoint(target), checkpoint(source))
    assert all(
        torch.isfinite(value).all()
        for value in renderer.render_rays(
            torch.zeros(1, 2, 3, dtype=dtype), torch.ones(1, 2, 3, dtype=dtype)
        ).values()
    )


BAD = [
    "missing_model",
    "extra_model",
    "late_shape",
    "nan_model",
    "complex_model",
    "cast_overflow",
    "empty_groups",
    "extra_groups",
    "duplicate_ids",
    "reordered_ids",
    "unknown_state",
    "missing_moment",
    "extra_moment",
    "moment_shape",
    "complex_moment",
    "integer_moment",
    "moment_nan",
    "moment_negative",
    "negative_underflow",
    "moment_cast_overflow",
    "negative_step",
    "fractional_step",
    "nonscalar_step",
    "nan_step",
    "bad_lr",
    "bad_beta",
    "short_beta",
    "bad_flag",
    "fused",
    "capturable",
    "differentiable",
    "max_below_second",
    "max_shape",
    "max_missing",
]


def damage(payload, kind):
    weights = payload["model_state_dict"]
    for name in weights:
        weights[name] += 0.125
    key = list(weights)[-1]
    state = payload["optimizer_state_dict"]
    group = state["param_groups"][0]
    moment = first_moment(payload)
    if kind == "missing_model":
        del weights[key]
    elif kind == "extra_model":
        weights["alien"] = torch.ones(1)
    elif kind == "late_shape":
        weights[key] = torch.ones(1)
    elif kind == "nan_model":
        weights[key].flatten()[0] = float("nan")
    elif kind == "complex_model":
        weights[key] = weights[key].to(torch.complex64)
    elif kind == "cast_overflow":
        weights[key] = torch.full(weights[key].shape, 1e100, dtype=torch.float64)
    elif kind == "empty_groups":
        state["param_groups"] = []
    elif kind == "extra_groups":
        state["param_groups"].append(copy.deepcopy(group))
    elif kind == "duplicate_ids":
        group["params"][-1] = group["params"][0]
    elif kind == "reordered_ids":
        group["params"].reverse()
    elif kind == "complex_moment":
        moment["exp_avg"] = moment["exp_avg"].to(torch.complex64)
    elif kind == "integer_moment":
        moment["exp_avg"] = moment["exp_avg"].to(torch.int64)
    elif kind == "unknown_state":
        state["state"][99999] = copy.deepcopy(moment)
    elif kind == "missing_moment":
        del moment["exp_avg"]
    elif kind == "extra_moment":
        moment["alien"] = torch.ones(1)
    elif kind == "moment_shape":
        moment["exp_avg_sq"] = torch.zeros(1)
    elif kind == "moment_nan":
        moment["exp_avg"].flatten()[0] = float("nan")
    elif kind == "moment_negative":
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
    elif kind == "nonscalar_step":
        moment["step"] = torch.tensor([1.0])
    elif kind == "nan_step":
        moment["step"] = torch.tensor(float("nan"))
    elif kind == "bad_lr":
        group["lr"] = float("nan")
    elif kind == "bad_beta":
        group["betas"] = (1.0, 0.9)
    elif kind == "short_beta":
        group["betas"] = (0.9,)
    elif kind == "bad_flag":
        group["amsgrad"] = "true"
    elif kind in ("fused", "capturable", "differentiable"):
        group[kind] = True
    elif kind == "max_below_second":
        moment["max_exp_avg_sq"] = torch.zeros_like(moment["exp_avg_sq"])
    elif kind == "max_shape":
        moment["max_exp_avg_sq"] = torch.zeros(1)
    elif kind == "max_missing":
        del moment["max_exp_avg_sq"]
    else:
        raise AssertionError(kind)


@pytest.mark.parametrize("kind", BAD)
def test_rejected_complete_pair_does_not_touch_live_state(tmp_path, kind):
    source = trainer(amsgrad=True)
    source.train_step(*observations())
    payload = checkpoint(source)
    target = trainer()
    target.train_step(*observations())
    target.model.eval()
    target.model.color_layers.train()
    before = checkpoint(target)
    grads = [
        p.grad.clone() if p.grad is not None else None
        for p in target.model.parameters()
    ]
    modes = [m.training for m in target.model.modules()]
    identities = [id(p) for p in target.model.parameters()]
    damage(payload, kind)
    with pytest.raises((ValueError, RuntimeError, TypeError)):
        target.load(write(tmp_path, payload))
    equal(checkpoint(target), before)
    equal([p.grad for p in target.model.parameters()], grads)
    assert modes == [m.training for m in target.model.modules()]
    assert identities == [id(p) for p in target.model.parameters()]
    target.load(write(tmp_path, checkpoint(source)))
    equal(checkpoint(target), checkpoint(source))


@pytest.mark.parametrize("phase", ["model", "optimizer"])
def test_ordinary_partial_publication_recovers_and_retries(
    tmp_path, monkeypatch, phase
):
    target = trainer()
    target.train_step(*observations())
    target.model.eval()
    target.model.density_layers.train()
    before = checkpoint(target)
    grads = [
        p.grad.clone() if p.grad is not None else None
        for p in target.model.parameters()
    ]
    modes = [m.training for m in target.model.modules()]
    source = trainer(amsgrad=True)
    source.train_step(*observations())
    with torch.no_grad():
        for p in source.model.parameters():
            p.add_(0.1)
    path = write(tmp_path, checkpoint(source))
    owner = target.model if phase == "model" else target.optimizer
    original = owner.load_state_dict

    def broken(*args, **kwargs):
        original(*args, **kwargs)
        target.model.train()
        for p in target.model.parameters():
            p.grad = None
        raise RuntimeError("ordinary publication fault")

    # Inject only publication, after genuine native loading; private preparation remains real.
    # Optimizer instance patch works directly; model class patch discriminates original owner,
    # avoiding an instance hook copied into the private candidate.
    if phase == "model":
        cls = type(target.model)
        class_original = cls.load_state_dict

        def model_broken(self, *args, **kwargs):
            if self is target.model:
                return broken(*args, **kwargs)
            return class_original(self, *args, **kwargs)

        monkeypatch.setattr(cls, "load_state_dict", model_broken)
    else:
        monkeypatch.setattr(owner, "load_state_dict", broken)
    with pytest.raises(RuntimeError, match="publication fault"):
        target.load(path)
    equal(checkpoint(target), before)
    equal([p.grad for p in target.model.parameters()], grads)
    assert modes == [m.training for m in target.model.modules()]
    monkeypatch.undo()
    target.load(path)
    equal(checkpoint(target), checkpoint(source))


@pytest.mark.parametrize(
    "source_dtype,target_dtype",
    [(torch.float32, torch.float64), (torch.float64, torch.float32)],
)
def test_native_cross_dtype_conversion(tmp_path, source_dtype, target_dtype):
    source = trainer(source_dtype, True)
    source.train_step(*observations(source_dtype))
    target = trainer(target_dtype)
    payload = checkpoint(source)
    target.load(write(tmp_path, payload))
    reference = trainer(target_dtype)
    reference.model.load_state_dict(payload["model_state_dict"])
    reference.optimizer.load_state_dict(payload["optimizer_state_dict"])
    equal(checkpoint(target), checkpoint(reference))
    target.train_step(*observations(target_dtype))
    reference.train_step(*observations(target_dtype))
    equal(checkpoint(target), checkpoint(reference))


def test_valid_checkpoint_repairs_corrupt_old_state(tmp_path):
    target = trainer()
    target.train_step(*observations())
    with torch.no_grad():
        next(target.model.parameters()).fill_(float("nan"))
    next(iter(target.optimizer.state.values()))["exp_avg_sq"].fill_(float("nan"))
    source = trainer()
    target.load(write(tmp_path, checkpoint(source)))
    equal(checkpoint(target), checkpoint(source))
    assert torch.isfinite(torch.tensor(target.train_step(*observations())))


def test_prepared_pair_owns_source_tensors():
    source = trainer()
    source.train_step(*observations())
    payload = checkpoint(source)
    model, optimizer = prepare_pair(source.model, source.optimizer, payload)
    expected = copy.deepcopy((model, optimizer))
    for tensor in payload["model_state_dict"].values():
        tensor.zero_()
    first_moment(payload)["exp_avg"].zero_()
    equal((model, optimizer), expected)


def test_save_and_train_wait_for_complete_restore(tmp_path, monkeypatch):
    target = trainer()
    source = trainer()
    source.train_step(*observations())
    path = write(tmp_path, checkpoint(source))
    entered, release = threading.Event(), threading.Event()
    original = target.optimizer.load_state_dict

    def paused(value):
        entered.set()
        assert release.wait(5)
        return original(value)

    monkeypatch.setattr(target.optimizer, "load_state_dict", paused)
    with ThreadPoolExecutor(max_workers=3) as pool:
        load = pool.submit(target.load, path)
        assert entered.wait(5)
        save = pool.submit(target.save, tmp_path / "after.pth")
        step = pool.submit(target.train_step, *observations())
        assert not save.done() and not step.done()
        release.set()
        load.result(5)
        save.result(5)
        step.result(5)
    assert all(torch.isfinite(p).all() for p in target.model.parameters())
