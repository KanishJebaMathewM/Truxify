"""Own and verify ordinary native SSL/AdamWW checkpoint pairs before publication."""

import copy

import torch
from foundation.optimizer_transition import (
    finite_policy_number,
    validate_optimizer_policy,
)

MAX_VALUES = 8_000_000


def model_config(model):
    family = type(model).__name__
    from self_supervised.model import MaskedAutoencoder, MoCo, SimCLR

    if type(model) not in (SimCLR, MoCo, MaskedAutoencoder):
        raise ValueError("SSL checkpoints require an ordinary registered SSL model")
    values = {
        "family": family,
        "input_dim": model.input_dim,
        "hidden_dim": model.hidden_dim,
    }
    if family in ("SimCLR", "MoCo"):
        values.update(
            projection_dim=model.projection_dim, temperature=model.temperature
        )
        if finite_policy_number(model.temperature, "temperature") <= 0:
            raise ValueError("SSL temperature must be positive")
    if family == "MoCo":
        values.update(queue_size=model.queue_size, momentum=model.momentum)
        if not 0 <= finite_policy_number(model.momentum, "momentum") <= 1:
            raise ValueError("SSL momentum must lie in [0,1]")
        if any(p.requires_grad for p in model.key_encoder.parameters()):
            raise ValueError("MoCo key parameters must remain frozen")
    if family == "MaskedAutoencoder":
        values.update(mask_ratio=model.mask_ratio)
        if not 0 <= finite_policy_number(model.mask_ratio, "mask_ratio") <= 1:
            raise ValueError("SSL mask ratio must lie in [0,1]")
    for key in ("input_dim", "hidden_dim", "projection_dim", "queue_size"):
        if key in values and (type(values[key]) is not int or values[key] <= 0):
            raise ValueError("SSL dimensions must be positive native integers")
    return values


def _model_state(model, state):
    expected = model.state_dict()
    if not isinstance(state, dict) or set(state) != set(expected):
        raise ValueError("Checkpoint must contain the complete registered SSL model")
    if sum(v.numel() for v in expected.values()) > MAX_VALUES:
        raise ValueError("SSL registered state exceeds checkpoint admission budget")
    for name, target in expected.items():
        value = state[name]
        if (
            not isinstance(value, torch.Tensor)
            or value.layout != torch.strided
            or value.shape != target.shape
            or not torch.isfinite(value).all()
        ):
            raise ValueError(f"Invalid registered SSL checkpoint tensor: {name}")
        if name == "queue_ptr":
            if (
                value.dtype != torch.int64
                or value.shape != (1,)
                or not 0 <= value.item() < model.queue_size
            ):
                raise ValueError(
                    "MoCo pointer requires an in-capacity native int64 scalar row"
                )
        elif not value.is_floating_point():
            raise ValueError(
                "Registered SSL weights/dictionary require floating tensors"
            )
    if "queue" in state:
        # Zero and epsilon-normalized tiny native features are legitimate keys.
        # Float64 norm avoids float32 overflow without silently normalizing an invalid file.
        norms = torch.linalg.vector_norm(state["queue"].double(), dim=0)
        if (norms > 1 + 2e-5).any():
            raise ValueError(
                "MoCo dictionary keys must fit native normalized-key magnitude"
            )


def _optimizer_format(state, params):
    count = len(params)
    if not isinstance(state, dict) or set(state) != {"state", "param_groups"}:
        raise ValueError("Checkpoint requires ordinary native AdamW state")
    groups = state["param_groups"]
    if not isinstance(groups, list) or len(groups) != 1:
        raise ValueError("SSL checkpoint requires one ordered native AdamW group")
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
        raise ValueError("Unsupported native AdamW parameter group")
    ids = group["params"]
    if (
        not isinstance(ids, list)
        or len(ids) != count
        or any(type(item) is not int for item in ids)
        or ids != list(range(count))
        or not isinstance(state["state"], dict)
        or any(type(key) is not int for key in state["state"])
        or not set(state["state"]) <= set(ids)
    ):
        raise ValueError(
            "AdamW checkpoint must bind every ordered registered parameter"
        )
    if (
        sum(
            value.numel()
            for moments in state["state"].values()
            if isinstance(moments, dict)
            for value in moments.values()
            if isinstance(value, torch.Tensor)
        )
        > 3 * MAX_VALUES
    ):
        raise ValueError("SSL optimizer moments exceed checkpoint admission budget")
    for index, parameter in zip(ids, params):
        moments = state["state"].get(index)
        if moments is None:
            continue
        if not isinstance(moments, dict):
            raise TypeError("AdamW moments must be a native mapping")
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
                raise ValueError(f"Invalid source AdamW moment: {name}")
        second = moments.get("exp_avg_sq")
        if second is not None and (second < 0).any():
            raise ValueError("Source AdamW second moments must be nonnegative")
        maximum = moments.get("max_exp_avg_sq")
        if maximum is not None and second is not None and (maximum < second).any():
            raise ValueError("Source AMSGrad maxima must dominate second moments")
    betas = group["betas"]
    if not isinstance(betas, (tuple, list)) or len(betas) != 2:
        raise ValueError("AdamW requires exactly two beta values")
    for name in (
        "amsgrad",
        "maximize",
        "capturable",
        "differentiable",
        "decoupled_weight_decay",
    ):
        if name in group and type(group[name]) is not bool:
            raise ValueError(f"AdamW {name} must be boolean")
    if (
        "decoupled_weight_decay" in group
        and group["decoupled_weight_decay"] is not True
    ):
        raise ValueError("SSL AdamW must preserve decoupled weight decay")
    for name in ("foreach", "fused"):
        if group.get(name) is not None and type(group[name]) is not bool:
            raise ValueError(f"AdamW {name} must be boolean or None")
    if group.get("capturable") or group.get("differentiable") or group.get("fused"):
        raise ValueError(
            "Capturable/differentiable/fused checkpoint policies are unsupported"
        )


def _native_pair(model, optimizer):
    model_config(model)
    _model_state(model, model.state_dict())
    validate_optimizer_policy(optimizer)
    if optimizer.param_groups[0]["eps"] <= 0:
        raise ValueError("SSL AdamW epsilon must be positive")
    params = list(model.parameters())
    bound = [p for g in optimizer.param_groups for p in g["params"]]
    if len(params) != len(bound) or any(a is not b for a, b in zip(params, bound)):
        raise ValueError("AdamW must retain the ordered registered parameter binding")
    amsgrad = optimizer.param_groups[0]["amsgrad"]
    for parameter, state in optimizer.state.items():
        if not any(parameter is item for item in params):
            raise ValueError("AdamW state contains an unregistered parameter")
        expected = {"step", "exp_avg", "exp_avg_sq"}
        if amsgrad:
            expected.add("max_exp_avg_sq")
        if not isinstance(state, dict) or set(state) != expected:
            raise ValueError(
                "Initialized AdamW state requires the complete native moment tuple"
            )
        step = state["step"]
        if (
            not isinstance(step, torch.Tensor)
            or step.ndim != 0
            or step.dtype not in (torch.float32, torch.float64)
        ):
            raise ValueError("AdamW step must be a native scalar")
        count = finite_policy_number(step, "step")
        if count < 0 or not count.is_integer():
            raise ValueError("AdamW step must be a nonnegative integer count")
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
                raise ValueError(f"Invalid native AdamW moment: {name}")
        second = state["exp_avg_sq"]
        if (second < 0).any():
            raise ValueError("AdamW second moments must be nonnegative")
        if amsgrad and (state["max_exp_avg_sq"] < second).any():
            raise ValueError("AMSGrad maxima must dominate native second moments")


def prepare_pair(model, optimizer, checkpoint):
    """Build a detached native candidate, checking again after native casts."""
    if type(optimizer) is not torch.optim.AdamW:
        raise ValueError("SSL checkpoint restore supports ordinary native AdamW")
    params = list(model.parameters())
    bound = [p for group in optimizer.param_groups for p in group["params"]]
    if (
        len(optimizer.param_groups) != 1
        or len(bound) != len(params)
        or any(a is not b for a, b in zip(params, bound))
    ):
        raise ValueError("SSL native optimizer must bind ordered registered parameters")
    if not params or any(
        p.dtype not in (torch.float32, torch.float64)
        or p.device.type not in ("cpu", "cuda")
        or p.dtype != params[0].dtype
        or p.device != params[0].device
        for p in params
    ):
        raise ValueError("SSL checkpoint restore requires float32/64 parameters")
    expected = {"model_state_dict", "optimizer_state_dict"}
    if not isinstance(checkpoint, dict) or set(checkpoint) not in (
        expected,
        expected | {"ssl_config"},
    ):
        raise ValueError("Checkpoint requires the existing complete SSL pair")
    config = model_config(model)
    if "ssl_config" in checkpoint:
        incoming = checkpoint["ssl_config"]
        if (
            not isinstance(incoming, dict)
            or set(incoming) != {"version", "model"}
            or type(incoming["version"]) is not int
            or incoming["version"] != 1
            or not isinstance(incoming["model"], dict)
            or incoming["model"] != config
            or any(
                type(incoming["model"][key]) is not type(value)
                for key, value in config.items()
            )
        ):
            raise ValueError("Checkpoint SSL objective/model configuration must match")
    _model_state(model, checkpoint["model_state_dict"])
    _optimizer_format(checkpoint["optimizer_state_dict"], params)
    owned = copy.deepcopy(checkpoint)
    _model_state(model, owned["model_state_dict"])
    _optimizer_format(owned["optimizer_state_dict"], params)
    candidate = copy.deepcopy(model)
    torch.nn.Module.load_state_dict(candidate, owned["model_state_dict"], strict=True)
    candidate_optimizer = torch.optim.AdamW(candidate.parameters())
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


def capture_pair(model, optimizer):
    """Return an independently owned, fully admitted save tuple with provenance."""
    checkpoint = {
        "model_state_dict": model.state_dict(),
        "optimizer_state_dict": optimizer.state_dict(),
        "ssl_config": {"version": 1, "model": model_config(model)},
    }
    weights, moments = prepare_pair(model, optimizer, checkpoint)
    return {
        "model_state_dict": copy.deepcopy(weights),
        "optimizer_state_dict": copy.deepcopy(moments),
        "ssl_config": copy.deepcopy(checkpoint["ssl_config"]),
    }
