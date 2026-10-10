"""Owned native training checkpoints, including deferred condition parameters."""

import copy

import torch
from foundation.optimizer_transition import (
    finite_policy_number,
    validate_optimizer_policy,
)
from torch.nn.parameter import UninitializedParameter

LAZY_NAMES = {"cond_proj.weight", "cond_proj.bias"}
LAZY_MARKER = {"deferred_condition_parameter": True}
MAX_VALUES = 32_000_000
MAX_HISTORY = 100_000


def _lazy(value):
    return isinstance(value, UninitializedParameter)


def _histories(values):
    if not isinstance(values, list) or len(values) > MAX_HISTORY:
        raise ValueError("Checkpoint history must be a bounded list")
    result = []
    for item in values:
        value = finite_policy_number(item, "loss history")
        if value < 0:
            raise ValueError("Native MSE history must be nonnegative")
        result.append(value)
    return result


def _model_plan(model, state):
    expected = model.state_dict()
    if not isinstance(state, dict) or set(state) != set(expected):
        raise ValueError("Checkpoint requires the complete registered denoiser")
    deferred = set()
    count = 0
    for name, target in expected.items():
        source = state[name]
        if isinstance(source, dict):
            if name not in LAZY_NAMES or source != LAZY_MARKER or not _lazy(target):
                raise ValueError(
                    "Deferred checkpoint state cannot reset a materialized schema"
                )
            deferred.add(name)
            continue
        if (
            not isinstance(source, torch.Tensor)
            or _lazy(source)
            or source.layout != torch.strided
            or not source.is_floating_point()
            or not torch.isfinite(source).all()
        ):
            raise ValueError(f"Invalid native denoiser tensor: {name}")
        if _lazy(target):
            if name not in LAZY_NAMES:
                raise ValueError(
                    "Only native deferred condition parameters are supported"
                )
            projection = model.cond_proj
            valid_shape = (
                (
                    source.ndim == 2
                    and source.shape[0] == projection.out_features
                    and source.shape[1] > 0
                )
                if name.endswith("weight")
                else (source.shape == (projection.out_features,))
            )
            if not valid_shape:
                raise ValueError("Invalid native deferred condition geometry")
        elif source.shape != target.shape:
            raise ValueError(
                f"Checkpoint geometry differs from registered state: {name}"
            )
        count += source.numel()
    if deferred and deferred != LAZY_NAMES:
        raise ValueError("Both deferred condition parameters must retain one schema")
    if count > MAX_VALUES:
        raise ValueError("Checkpoint exceeds its registered value admission budget")
    return deferred


def _schedule(model):
    names = ("betas", "alphas", "alpha_bars")
    if not all(hasattr(model, name) for name in names):
        return
    betas, alphas, bars = (getattr(model, name) for name in names)
    if (
        any(
            value.shape != (model.num_timesteps,) or not torch.isfinite(value).all()
            for value in (betas, alphas, bars)
        )
        or (betas < 0).any()
        or (betas >= 1).any()
        or (alphas <= 0).any()
        or (alphas > 1).any()
        or (bars <= 0).any()
        or (bars > 1).any()
    ):
        raise ValueError(
            "Checkpoint noise schedule must retain finite native probabilities"
        )
    # Existing double models may carry buffers converted from float32. Preserve
    # their conversion roundoff rather than requiring recomputed bitwise equality.
    if not torch.allclose(
        alphas, 1 - betas, rtol=2e-5, atol=2e-7
    ) or not torch.allclose(bars, torch.cumprod(alphas, dim=0), rtol=2e-5, atol=2e-7):
        raise ValueError("Checkpoint beta/alpha/cumulative schedule is incoherent")


def _optimizer_format(state, parameters):
    if not isinstance(state, dict) or set(state) != {"state", "param_groups"}:
        raise ValueError("Checkpoint requires native AdamW state")
    groups = state["param_groups"]
    if not isinstance(groups, list) or len(groups) != 1:
        raise ValueError("Checkpoint requires one canonical AdamW parameter group")
    group = groups[0]
    required = {"params", "lr", "betas", "eps", "weight_decay", "amsgrad"}
    allowed = required | {
        "maximize",
        "foreach",
        "capturable",
        "differentiable",
        "fused",
        "decoupled_weight_decay",
    }
    if not isinstance(group, dict) or not required <= set(group) <= allowed:
        raise ValueError("Unsupported native AdamW group policy")
    ids = group["params"]
    if (
        not isinstance(ids, list)
        or any(type(item) is not int for item in ids)
        or ids != list(range(len(parameters)))
        or not isinstance(state["state"], dict)
        or not set(state["state"]) <= set(ids)
    ):
        raise ValueError("AdamW checkpoint must retain canonical registered binding")
    if not isinstance(group["betas"], (tuple, list)) or len(group["betas"]) != 2:
        raise ValueError("AdamW requires exactly two beta values")
    for name in (
        "amsgrad",
        "maximize",
        "capturable",
        "differentiable",
        "decoupled_weight_decay",
    ):
        if name in group and type(group[name]) is not bool:
            raise ValueError("AdamW scalar flags must be boolean")
    for name in ("foreach", "fused"):
        if group.get(name) is not None and type(group[name]) is not bool:
            raise ValueError("AdamW execution flags must be boolean or None")
    if group.get("capturable") or group.get("differentiable") or group.get("fused"):
        raise ValueError(
            "Capturable/differentiable/fused checkpoint policy unsupported"
        )
    for index, parameter in zip(ids, parameters):
        if index not in state["state"]:
            continue
        if _lazy(parameter):
            raise ValueError(
                "Deferred parameters cannot have initialized native moments"
            )
        moments = state["state"][index]
        expected = {"step", "exp_avg", "exp_avg_sq"}
        if group["amsgrad"]:
            expected.add("max_exp_avg_sq")
        if not isinstance(moments, dict) or set(moments) != expected:
            raise ValueError(
                "Initialized AdamW state requires its complete moment tuple"
            )
        step = moments["step"]
        if isinstance(step, torch.Tensor) and step.ndim != 0:
            raise ValueError("AdamW step requires a scalar")
        value = finite_policy_number(step, "step")
        if value < 0 or not value.is_integer():
            raise ValueError("AdamW step requires a nonnegative integral count")
        for name in expected - {"step"}:
            moment = moments[name]
            if (
                not isinstance(moment, torch.Tensor)
                or moment.layout != torch.strided
                or not moment.is_floating_point()
                or moment.shape != parameter.shape
                or not torch.isfinite(moment).all()
            ):
                raise ValueError("Invalid native AdamW moment geometry/value")
        second = moments["exp_avg_sq"]
        if (second < 0).any() or (
            group["amsgrad"] and (moments["max_exp_avg_sq"] < second).any()
        ):
            raise ValueError("AdamW variance/maxima must be nonnegative and coherent")


def _native_pair(model, optimizer):
    if type(optimizer) is not torch.optim.AdamW:
        raise ValueError("Checkpoint supports ordinary native AdamW")
    parameters = list(model.parameters())
    if not parameters or any(
        p.dtype not in (torch.float32, torch.float64) for p in parameters
    ):
        raise ValueError("Native checkpoints require float32/64 registered parameters")
    bound = [p for group in optimizer.param_groups for p in group["params"]]
    if len(bound) != len(parameters) or any(
        a is not b for a, b in zip(bound, parameters)
    ):
        raise ValueError("Native AdamW must own ordered registered parameters")
    _optimizer_format(optimizer.state_dict(), parameters)
    validate_optimizer_policy(optimizer)
    for value in model.state_dict().values():
        if not _lazy(value) and not torch.isfinite(value).all():
            raise ValueError("Native denoiser state is nonfinite after conversion")
    for parameter, moments in optimizer.state.items():
        for name in ("exp_avg", "exp_avg_sq", "max_exp_avg_sq"):
            if name in moments and (
                moments[name].dtype != parameter.dtype
                or moments[name].device != parameter.device
            ):
                raise ValueError("Native moments must match their registered parameter")
    _schedule(model)


def capture_checkpoint(owner):
    """Encode fresh lazy parameters without custom pickle globals."""
    _native_pair(owner.model, owner.optimizer)
    state = {
        name: copy.deepcopy(LAZY_MARKER) if _lazy(value) else value.detach().clone()
        for name, value in owner.model.state_dict().items()
    }
    _model_plan(owner.model, state)
    return {
        "model_state_dict": state,
        "optimizer_state_dict": copy.deepcopy(owner.optimizer.state_dict()),
        "train_losses": _histories(owner.train_losses),
        "val_losses": _histories(owner.val_losses),
    }


def _projection_width(model):
    projection = getattr(model, "cond_proj", None)
    if projection is not None and not _lazy(projection.weight):
        projection.in_features = projection.weight.shape[1]


def prepare_checkpoint(owner, checkpoint):
    if type(owner.optimizer) is not torch.optim.AdamW:
        raise ValueError("Checkpoint receiver requires ordinary native AdamW")
    parameters = list(owner.model.parameters())
    bound = [p for group in owner.optimizer.param_groups for p in group["params"]]
    if len(bound) != len(parameters) or any(
        a is not b for a, b in zip(bound, parameters)
    ):
        raise ValueError(
            "Checkpoint receiver must retain registered parameter ownership"
        )
    required = {
        "model_state_dict",
        "optimizer_state_dict",
        "train_losses",
        "val_losses",
    }
    if not isinstance(checkpoint, dict) or not required <= set(
        checkpoint
    ) <= required | {"timestamp"}:
        raise ValueError("Checkpoint requires the complete native trainer tuple")
    deferred = _model_plan(owner.model, checkpoint["model_state_dict"])
    train, val = (
        _histories(checkpoint["train_losses"]),
        _histories(checkpoint["val_losses"]),
    )
    state = copy.deepcopy(
        {
            name: value
            for name, value in checkpoint["model_state_dict"].items()
            if name not in deferred
        }
    )
    candidate = copy.deepcopy(owner.model)
    result = candidate.load_state_dict(state, strict=not deferred)
    if set(result.missing_keys) != deferred or result.unexpected_keys:
        raise ValueError("Checkpoint deferred state must be complete")
    _projection_width(candidate)
    parameters = list(candidate.parameters())
    optimizer_state = copy.deepcopy(checkpoint["optimizer_state_dict"])
    _optimizer_format(optimizer_state, parameters)
    optimizer = torch.optim.AdamW(parameters)
    optimizer.load_state_dict(optimizer_state)
    _native_pair(candidate, optimizer)
    return state, optimizer.state_dict(), train, val, deferred


def restore_checkpoint(owner, checkpoint):
    state, optimizer_state, train, val, deferred = prepare_checkpoint(owner, checkpoint)
    registered = owner.model.state_dict(keep_vars=True)
    before = {
        name: (type(value), value.data.detach().clone())
        for name, value in registered.items()
    }
    old_groups, old_state = owner.optimizer.param_groups, owner.optimizer.state
    groups = [
        {
            key: list(value) if key == "params" else copy.deepcopy(value)
            for key, value in group.items()
        }
        for group in old_groups
    ]
    moments = {p: copy.deepcopy(value) for p, value in old_state.items()}
    gradients = [
        (p, None if p.grad is None else p.grad.detach().clone())
        for p in owner.model.parameters()
    ]
    modes = [(module, module.training) for module in owner.model.modules()]
    old_train, old_val = owner.train_losses, owner.val_losses
    projection = getattr(owner.model, "cond_proj", None)
    old_width = None if projection is None else projection.in_features
    try:
        result = owner.model.load_state_dict(state, strict=not deferred)
        if set(result.missing_keys) != deferred or result.unexpected_keys:
            raise ValueError("Incomplete live checkpoint publication")
        _projection_width(owner.model)
        owner.optimizer.load_state_dict(optimizer_state)
        _native_pair(owner.model, owner.optimizer)
        owner.train_losses, owner.val_losses = train, val
    except Exception:
        with torch.no_grad():
            for name, value in registered.items():
                cls, data = before[name]
                if cls is UninitializedParameter:
                    # Reverse the native materialize data/class transition. No
                    # forward runs during publication, so its lazy hooks remain.
                    value.data = data
                    value.__class__ = cls
                else:
                    value.copy_(data)
        for group, values in zip(old_groups, groups):
            group.clear()
            group.update(values)
        owner.optimizer.param_groups = old_groups
        old_state.clear()
        old_state.update(moments)
        owner.optimizer.state = old_state
        for parameter, gradient in gradients:
            parameter.grad = gradient
        for module, mode in modes:
            module.training = mode
        owner.train_losses, owner.val_losses = old_train, old_val
        if projection is not None:
            projection.in_features = old_width
        raise
