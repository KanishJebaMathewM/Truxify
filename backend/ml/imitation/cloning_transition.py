"""Owned continuous observations and native cloning-component transitions."""

from functools import wraps
from numbers import Integral

import numpy as np
import torch
from foundation.optimizer_transition import (
    finite_policy_number,
    validate_optimizer_policy,
)

MAX_ROWS = 10_000
MAX_ROW_EPOCHS = 2_000_000


def parameter(model):
    parameters = list(model.parameters())
    first = parameters[0]
    if (
        first.dtype not in (torch.float32, torch.float64)
        or first.device.type not in ("cpu", "cuda")
        or any(p.dtype != first.dtype or p.device != first.device for p in parameters)
    ):
        raise ValueError(
            "Cloning requires uniform native float32/64 CPU or CUDA parameters"
        )
    return first


def numeric(model, value):
    native = parameter(model)
    try:
        source = torch.as_tensor(
            value if isinstance(value, torch.Tensor) else np.asarray(value),
            device=native.device,
        )
    except (ValueError, TypeError, RuntimeError) as error:
        raise ValueError("Cloning observations require real numeric arrays") from error
    if (
        source.layout != torch.strided
        or source.is_complex()
        or source.dtype == torch.bool
        or not torch.isfinite(source).all()
    ):
        raise ValueError("Cloning observations must be finite real arrays")
    result = source.detach().to(dtype=native.dtype).clone()
    if not torch.isfinite(result).all():
        raise ValueError("Cloning observations overflow native model dtype")
    return result


def states(model, value):
    result = numeric(model, value)
    if result.ndim == 1:
        result = result.unsqueeze(0)
    if (
        result.ndim != 2
        or result.shape[1] != model.state_dim
        or not 1 <= len(result) <= MAX_ROWS
    ):
        raise ValueError("Cloning states require bounded nonempty state_dim rows")
    return result


def demonstrations(owner, expert_states, expert_actions, epochs, batch_size):
    for value, name, maximum in (
        (epochs, "epochs", 1000),
        (batch_size, "batch_size", MAX_ROWS),
    ):
        if (
            isinstance(value, bool)
            or not isinstance(value, Integral)
            or not 1 <= value <= maximum
        ):
            raise ValueError(f"Cloning {name} requires an integer in [1,{maximum}]")
    model = owner.behavioral_cloning
    x, y = numeric(model, expert_states), numeric(model, expert_actions)
    if x.ndim != 2 or not 1 <= len(x) <= MAX_ROWS or x.shape[1] != model.state_dim:
        raise ValueError("states must be bounded nonempty rows with state_dim features")
    if y.shape != (len(x), model.action_dim):
        raise ValueError("actions must have one action_dim vector per state row")
    if len(x) * epochs > MAX_ROW_EPOCHS:
        raise ValueError("Cloning fit exceeds its row-epoch budget")
    return x, y, int(epochs), int(batch_size)


def admit_optimizer(owner):
    model, optimizer = owner.behavioral_cloning, owner.bc_optimizer
    parameter(model)
    if type(optimizer) is not torch.optim.Adam or len(optimizer.param_groups) != 1:
        raise ValueError("Cloning requires one ordinary native Adam group")
    validate_optimizer_policy(optimizer)
    group = optimizer.param_groups[0]
    if any(
        group.get(option, False)
        for option in (
            "fused",
            "capturable",
            "differentiable",
            "decoupled_weight_decay",
        )
    ):
        raise ValueError("Cloning requires ordinary coupled nonfused Adam")
    parameters = list(model.parameters())
    bound = group["params"]
    if len(parameters) != len(bound) or any(
        a is not b for a, b in zip(parameters, bound)
    ):
        raise ValueError("Cloning Adam must bind the ordered registered parameters")
    if any(not torch.isfinite(value).all() for value in model.state_dict().values()):
        raise ValueError("Cloning registered state must be finite")
    for p, moments in optimizer.state.items():
        required = {"step", "exp_avg", "exp_avg_sq"}
        if group["amsgrad"]:
            required.add("max_exp_avg_sq")
        if (
            not any(p is candidate for candidate in parameters)
            or not isinstance(moments, dict)
            or set(moments) != required
        ):
            raise ValueError("Cloning native moments must match registered parameters")
        step = moments["step"]
        if (
            not isinstance(step, torch.Tensor)
            or step.ndim != 0
            or step.dtype not in (torch.float32, torch.float64)
        ):
            raise ValueError("Cloning Adam step requires a native scalar float count")
        count = finite_policy_number(step, "step")
        if count < 0 or not count.is_integer():
            raise ValueError("Cloning Adam step must be nonnegative integral")
        for name in required - {"step"}:
            value = moments[name]
            if (
                not isinstance(value, torch.Tensor)
                or value.layout != torch.strided
                or value.shape != p.shape
                or value.dtype != p.dtype
                or value.device != p.device
                or not torch.isfinite(value).all()
            ):
                raise ValueError(
                    "Cloning moments require finite compatible native geometry"
                )
            if name != "exp_avg" and (value < 0).any():
                raise ValueError("Cloning Adam variance must be nonnegative")
        if (
            group["amsgrad"]
            and (moments["max_exp_avg_sq"] < moments["exp_avg_sq"]).any()
        ):
            raise ValueError("Cloning AMSGrad maximum must dominate its variance")


def cloning_owned(method):
    @wraps(method)
    def owned(self, *args, **kwargs):
        with self.behavioral_cloning._operation_lock:
            return method(self, *args, **kwargs)

    return owned
