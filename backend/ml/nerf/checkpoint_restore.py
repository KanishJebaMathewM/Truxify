"""Own and verify ordinary native NeRF/Adam checkpoint pairs before publication."""

import copy

import torch
from foundation.optimizer_transition import (
    finite_policy_number,
    validate_optimizer_policy,
)


def _model_state(model, state):
    expected = model.state_dict()
    if not isinstance(state, dict) or set(state) != set(expected):
        raise ValueError("Checkpoint must contain the complete registered model")
    for name, target in expected.items():
        source = state[name]
        if (
            not isinstance(source, torch.Tensor)
            or source.layout != torch.strided
            or not source.is_floating_point()
            or source.shape != target.shape
            or not torch.isfinite(source).all()
        ):
            raise ValueError(f"Invalid registered checkpoint tensor: {name}")


def _optimizer_format(state, params):
    count = len(params)
    if not isinstance(state, dict) or set(state) != {"state", "param_groups"}:
        raise ValueError("Checkpoint requires ordinary native Adam state")
    groups = state["param_groups"]
    if not isinstance(groups, list) or len(groups) != 1:
        raise ValueError("NeRF checkpoint requires one ordered native Adam group")
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
        raise ValueError("Unsupported native Adam parameter group")
    ids = group["params"]
    if (
        not isinstance(ids, list)
        or len(ids) != count
        or any(type(item) is not int for item in ids)
        or ids != list(range(count))
        or not isinstance(state["state"], dict)
        or not set(state["state"]) <= set(ids)
    ):
        raise ValueError("Adam checkpoint must bind every ordered registered parameter")
    for index, parameter in zip(ids, params):
        moments = state["state"].get(index)
        if moments is None:
            continue
        if not isinstance(moments, dict):
            raise TypeError("Adam moments must be a native mapping")
        for name in ("exp_avg", "exp_avg_sq", "max_exp_avg_sq"):
            if name not in moments:
                continue
            value = moments[name]
            if (
                not isinstance(value, torch.Tensor)
                or value.layout != torch.strided
                or not value.is_floating_point()
                or value.shape != parameter.shape
                or not torch.isfinite(value).all()
            ):
                raise ValueError(f"Invalid source Adam moment: {name}")
        second = moments.get("exp_avg_sq")
        if second is not None and (second < 0).any():
            raise ValueError("Source Adam second moments must be nonnegative")
        maximum = moments.get("max_exp_avg_sq")
        if maximum is not None and second is not None and (maximum < second).any():
            raise ValueError("Source AMSGrad maxima must dominate second moments")
    betas = group["betas"]
    if not isinstance(betas, (tuple, list)) or len(betas) != 2:
        raise ValueError("Adam requires exactly two beta values")
    for name in (
        "amsgrad",
        "maximize",
        "capturable",
        "differentiable",
        "decoupled_weight_decay",
    ):
        if name in group and type(group[name]) is not bool:
            raise ValueError(f"Adam {name} must be boolean")
    for name in ("foreach", "fused"):
        if group.get(name) is not None and type(group[name]) is not bool:
            raise ValueError(f"Adam {name} must be boolean or None")
    if group.get("capturable") or group.get("differentiable") or group.get("fused"):
        raise ValueError(
            "Capturable/differentiable/fused checkpoint policies are unsupported"
        )


def _native_pair(model, optimizer):
    _model_state(model, model.state_dict())
    validate_optimizer_policy(optimizer)
    params = list(model.parameters())
    bound = [p for g in optimizer.param_groups for p in g["params"]]
    if len(params) != len(bound) or any(a is not b for a, b in zip(params, bound)):
        raise ValueError("Adam must retain the ordered registered parameter binding")
    amsgrad = optimizer.param_groups[0]["amsgrad"]
    for parameter, state in optimizer.state.items():
        if not any(parameter is item for item in params):
            raise ValueError("Adam state contains an unregistered parameter")
        expected = {"step", "exp_avg", "exp_avg_sq"}
        if amsgrad:
            expected.add("max_exp_avg_sq")
        if not isinstance(state, dict) or set(state) != expected:
            raise ValueError(
                "Initialized Adam state requires the complete native moment tuple"
            )
        step = state["step"]
        if not isinstance(step, torch.Tensor) or step.ndim != 0:
            raise ValueError("Adam step must be a native scalar")
        count = finite_policy_number(step, "step")
        if count < 0 or not count.is_integer():
            raise ValueError("Adam step must be a nonnegative integer count")
        for name in expected - {"step"}:
            moment = state[name]
            if (
                not isinstance(moment, torch.Tensor)
                or moment.layout != torch.strided
                or moment.shape != parameter.shape
                or moment.dtype != parameter.dtype
                or moment.device != parameter.device
                or not torch.isfinite(moment).all()
            ):
                raise ValueError(f"Invalid native Adam moment: {name}")
        second = state["exp_avg_sq"]
        if (second < 0).any():
            raise ValueError("Adam second moments must be nonnegative")
        if amsgrad and (state["max_exp_avg_sq"] < second).any():
            raise ValueError("AMSGrad maxima must dominate native second moments")


def prepare_pair(model, optimizer, checkpoint):
    """Build a detached native candidate, checking again after native casts."""
    if type(optimizer) is not torch.optim.Adam:
        raise ValueError("NeRF checkpoint restore supports ordinary native Adam")
    params = list(model.parameters())
    if not params or any(p.dtype not in (torch.float32, torch.float64) for p in params):
        raise ValueError("NeRF checkpoint restore requires float32/64 parameters")
    if not isinstance(checkpoint, dict) or set(checkpoint) != {
        "model_state_dict",
        "optimizer_state_dict",
    }:
        raise ValueError("Checkpoint requires the existing complete NeRF pair")
    owned = copy.deepcopy(checkpoint)
    _model_state(model, owned["model_state_dict"])
    _optimizer_format(owned["optimizer_state_dict"], params)
    candidate = copy.deepcopy(model)
    candidate.load_state_dict(owned["model_state_dict"], strict=True)
    candidate_optimizer = torch.optim.Adam(candidate.parameters())
    candidate_optimizer.load_state_dict(owned["optimizer_state_dict"])
    _native_pair(candidate, candidate_optimizer)
    return candidate.state_dict(), candidate_optimizer.state_dict()


def restore_pair(model, optimizer, checkpoint):
    """Publish into existing objects; recover ordinary copy/load failures directly."""
    model_state, optimizer_state = prepare_pair(model, optimizer, checkpoint)
    registered = model.state_dict(keep_vars=True)
    before = {name: value.detach().clone() for name, value in registered.items()}
    old_groups = optimizer.param_groups
    old_state = optimizer.state
    group_values = [
        {
            key: list(value) if key == "params" else copy.deepcopy(value)
            for key, value in group.items()
        }
        for group in old_groups
    ]
    moment_values = {p: copy.deepcopy(value) for p, value in old_state.items()}
    gradients = [
        (p, None if p.grad is None else p.grad.detach().clone())
        for p in model.parameters()
    ]
    modes = [(module, module.training) for module in model.modules()]
    try:
        model.load_state_dict(model_state, strict=True)
        optimizer.load_state_dict(optimizer_state)
        _native_pair(model, optimizer)
    except Exception:
        with torch.no_grad():
            for name, value in registered.items():
                value.copy_(before[name])
        for group, values in zip(old_groups, group_values):
            group.clear()
            group.update(values)
        optimizer.param_groups = old_groups
        old_state.clear()
        old_state.update(moment_values)
        optimizer.state = old_state
        for parameter, gradient in gradients:
            parameter.grad = gradient
        for module, mode in modes:
            module.training = mode
        raise
