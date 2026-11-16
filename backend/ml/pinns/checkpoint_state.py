"""Own and verify ordinary native PINN/Adam checkpoint pairs before publication."""

import copy
import math

import torch
from foundation.optimizer_transition import (
    finite_policy_number,
    validate_optimizer_policy,
)


def _model_state(model, state):
    expected = model.state_dict()
    if not isinstance(state, dict) or set(state) != set(expected):
        raise ValueError("Checkpoint must contain the complete registered model")
    if sum(v.numel() for v in expected.values()) > 8_000_000:
        raise ValueError("PINN state exceeds checkpoint admission budget")
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
        raise ValueError("PINN checkpoint requires one ordered native Adam group")
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
        or any(type(key) is not int for key in state["state"])
        or not set(state["state"]) <= set(ids)
    ):
        raise ValueError("Adam checkpoint must bind every ordered registered parameter")
    if (
        sum(
            v.numel()
            for entry in state["state"].values()
            if isinstance(entry, dict)
            for v in entry.values()
            if isinstance(v, torch.Tensor)
        )
        > 24_000_000
    ):
        raise ValueError("PINN moments exceed checkpoint admission budget")
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
    if group.get("decoupled_weight_decay", False):
        raise ValueError("PINN checkpoint requires the existing coupled native Adam")
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
    if optimizer.param_groups[0]["eps"] <= 0:
        raise ValueError("PINN Adam epsilon must be positive")
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
        if (
            not isinstance(step, torch.Tensor)
            or step.ndim != 0
            or step.dtype not in (torch.float32, torch.float64)
        ):
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


def objective_config(owner):
    from pinns.model import PhysicsInformedNN, PhysicsLoss

    if (
        type(owner.model) is not PhysicsInformedNN
        or type(owner.physics_loss) is not PhysicsLoss
    ):
        raise ValueError("PINN checkpoints require the ordinary native model/objective")
    model = owner.model
    activation = model.activation.__name__
    if activation not in (
        "tanh",
        "relu",
        "silu",
    ) or owner.physics_loss.physics_type not in (
        "diffusion",
        "advection",
        "burger",
        "poisson",
    ):
        raise ValueError("PINN checkpoint objective/activation is unsupported")
    config = {
        "input_dim": model.input_dim,
        "hidden_dim": model.hidden_dim,
        "output_dim": model.output_dim,
        "num_layers": model.num_layers,
        "activation": activation,
        "physics_type": owner.physics_loss.physics_type,
        "data_weight": finite_policy_number(owner.data_weight, "data_weight"),
        "physics_weight": finite_policy_number(owner.physics_weight, "physics_weight"),
    }
    for key in ("input_dim", "hidden_dim", "output_dim", "num_layers"):
        if type(config[key]) is not int or config[key] < 1:
            raise ValueError(
                "PINN checkpoint geometry requires positive native integers"
            )
    return config


def scheduler_state(state, optimizer):
    expected = set(torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer).state_dict())
    if not isinstance(state, dict) or set(state) != expected:
        raise ValueError(
            "PINN checkpoint requires complete native plateau scheduler state"
        )
    if state["mode"] not in ("min", "max") or state["threshold_mode"] not in (
        "rel",
        "abs",
    ):
        raise ValueError("Native plateau mode/threshold policy is invalid")
    for name in (
        "last_epoch",
        "patience",
        "cooldown",
        "cooldown_counter",
        "num_bad_epochs",
    ):
        if type(state[name]) is not int or state[name] < 0:
            raise ValueError(
                "Plateau history/counts require nonnegative native integers"
            )
    if (
        state["cooldown_counter"] > state["cooldown"]
        or state["num_bad_epochs"] > state["patience"]
    ):
        raise ValueError("Plateau counters contradict native cooldown/patience history")
    factor = finite_policy_number(state["factor"], "factor")
    if not 0 <= factor < 1:
        raise ValueError("Plateau reduction factor must lie in [0,1)")
    for name in ("eps", "threshold"):
        if finite_policy_number(state[name], name) < 0:
            raise ValueError("Plateau epsilon/threshold must be nonnegative")
    if (
        state["default_min_lr"] is not None
        and finite_policy_number(state["default_min_lr"], "default_min_lr") < 0
    ):
        raise ValueError("Plateau minimum learning rate must be nonnegative")
    for name in ("min_lrs", "_last_lr"):
        values = state[name]
        if not isinstance(values, list) or len(values) != len(optimizer.param_groups):
            raise ValueError("Plateau learning-rate rows must match optimizer groups")
        if any(finite_policy_number(value, name) < 0 for value in values):
            raise ValueError("Plateau learning rates must be finite and nonnegative")
    if state["_last_lr"] != [group["lr"] for group in optimizer.param_groups]:
        raise ValueError("Plateau last learning rate must match the paired native Adam")
    worse = math.inf if state["mode"] == "min" else -math.inf
    if type(state["mode_worse"]) not in (int, float) or state["mode_worse"] != worse:
        raise ValueError("Plateau mode sentinel must match its native mode")
    best = state["best"]
    if isinstance(best, bool) or not isinstance(best, (int, float)) or math.isnan(best):
        raise ValueError(
            "Plateau best metric must be finite or the initial mode sentinel"
        )
    if not math.isfinite(best) and (best != worse or state["last_epoch"] != 0):
        raise ValueError("Plateau nonfinite best metric is only an initial sentinel")


def prepare_state(owner, checkpoint):
    if (
        type(owner.optimizer) is not torch.optim.Adam
        or type(owner.scheduler) is not torch.optim.lr_scheduler.ReduceLROnPlateau
        or owner.scheduler.optimizer is not owner.optimizer
    ):
        raise ValueError(
            "PINN checkpoint requires a bound ordinary Adam/plateau scheduler"
        )
    params = list(owner.model.parameters())
    bound = [p for g in owner.optimizer.param_groups for p in g["params"]]
    if (
        len(owner.optimizer.param_groups) != 1
        or len(bound) != len(params)
        or any(a is not b for a, b in zip(params, bound))
    ):
        raise ValueError("PINN Adam must bind the ordered registered parameters")
    if not params or any(
        p.dtype not in (torch.float32, torch.float64)
        or p.device.type not in ("cpu", "cuda")
        or p.dtype != params[0].dtype
        or p.device != params[0].device
        for p in params
    ):
        raise ValueError(
            "PINN checkpoints require uniform native float32/64 CPU or CUDA"
        )
    legacy = {"model_state_dict", "optimizer_state_dict"}
    complete = legacy | {"scheduler_state_dict", "pinn_config"}
    if not isinstance(checkpoint, dict) or set(checkpoint) not in (legacy, complete):
        raise ValueError("PINN checkpoint requires a complete native tuple")
    config = objective_config(owner)
    if set(checkpoint) == complete:
        incoming = checkpoint["pinn_config"]
        if (
            not isinstance(incoming, dict)
            or set(incoming) != {"version", "objective"}
            or type(incoming["version"]) is not int
            or incoming["version"] != 1
            or not isinstance(incoming["objective"], dict)
            or incoming["objective"] != config
            or any(
                type(incoming["objective"][key]) is not type(value)
                for key, value in config.items()
            )
        ):
            raise ValueError("PINN checkpoint objective/model configuration must match")
    _model_state(owner.model, checkpoint["model_state_dict"])
    _optimizer_format(checkpoint["optimizer_state_dict"], params)
    owned = copy.deepcopy(checkpoint)
    candidate = copy.deepcopy(owner.model)
    torch.nn.Module.load_state_dict(candidate, owned["model_state_dict"], strict=True)
    optimizer = torch.optim.Adam(candidate.parameters())
    optimizer.load_state_dict(owned["optimizer_state_dict"])
    _native_pair(candidate, optimizer)
    schedule = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer)
    if set(owned) == complete:
        state = owned["scheduler_state_dict"]
    else:
        # Explicit legacy weights/Adam continuation, not invented scheduler history.
        state = copy.deepcopy(owner.scheduler.state_dict())
        state.update(
            last_epoch=0,
            best=state["mode_worse"],
            cooldown_counter=0,
            num_bad_epochs=0,
            _last_lr=[group["lr"] for group in optimizer.param_groups],
        )
    scheduler_state(state, optimizer)
    schedule.load_state_dict(state)
    return candidate.state_dict(), optimizer.state_dict(), schedule.state_dict()


def restore_state(owner, checkpoint):
    weights, moments, schedule = prepare_state(owner, checkpoint)
    registered = owner.model.state_dict(keep_vars=True)
    before = {name: value.detach().clone() for name, value in registered.items()}
    old_groups, old_state = owner.optimizer.param_groups, owner.optimizer.state
    groups = [
        {
            key: list(value) if key == "params" else copy.deepcopy(value)
            for key, value in group.items()
        }
        for group in old_groups
    ]
    states = {p: copy.deepcopy(value) for p, value in old_state.items()}
    scheduler_before = {
        key: value if key == "optimizer" else copy.deepcopy(value)
        for key, value in owner.scheduler.__dict__.items()
    }
    gradients = [
        (p, None if p.grad is None else p.grad.detach().clone())
        for p in owner.model.parameters()
    ]
    modes = [(module, module.training) for module in owner.model.modules()]
    try:
        owner.model.load_state_dict(weights, strict=True)
        owner.optimizer.load_state_dict(moments)
        owner.scheduler.load_state_dict(schedule)
        _native_pair(owner.model, owner.optimizer)
        scheduler_state(owner.scheduler.state_dict(), owner.optimizer)
    except Exception:
        with torch.no_grad():
            for name, value in registered.items():
                value.copy_(before[name])
        for group, values in zip(old_groups, groups):
            group.clear()
            group.update(values)
        owner.optimizer.param_groups = old_groups
        old_state.clear()
        old_state.update(states)
        owner.optimizer.state = old_state
        owner.scheduler.__dict__.clear()
        owner.scheduler.__dict__.update(scheduler_before)
        for parameter, gradient in gradients:
            parameter.grad = gradient
        for module, mode in modes:
            module.training = mode
        raise


def capture_state(owner):
    checkpoint = {
        "model_state_dict": owner.model.state_dict(),
        "optimizer_state_dict": owner.optimizer.state_dict(),
        "scheduler_state_dict": owner.scheduler.state_dict(),
        "pinn_config": {"version": 1, "objective": objective_config(owner)},
    }
    weights, moments, schedule = prepare_state(owner, checkpoint)
    return copy.deepcopy(
        {
            "model_state_dict": weights,
            "optimizer_state_dict": moments,
            "scheduler_state_dict": schedule,
            "pinn_config": checkpoint["pinn_config"],
        }
    )
