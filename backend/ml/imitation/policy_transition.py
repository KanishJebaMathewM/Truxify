"""Owned categorical observations and native policy-component operation fence."""

from functools import wraps
from numbers import Integral

import numpy as np
import torch
from foundation.optimizer_transition import validate_optimizer_policy

MAX_ROWS = 10_000
MAX_ROW_EPOCHS = 2_000_000


def native_parameter(owner):
    parameter = next(owner.policy.parameters())
    if parameter.dtype not in (
        torch.float32,
        torch.float64,
    ) or parameter.device.type not in ("cpu", "cuda"):
        raise ValueError(
            "Policy observations require a native float32/64 CPU or CUDA model"
        )
    if any(
        p.dtype != parameter.dtype or p.device != parameter.device
        for p in owner.policy.parameters()
    ):
        raise ValueError("Policy parameters must share one native dtype/device")
    return parameter


def owned_numeric(value, parameter, dtype):
    try:
        source = torch.as_tensor(
            value if isinstance(value, torch.Tensor) else np.asarray(value),
            device=parameter.device,
        )
    except (ValueError, TypeError, RuntimeError) as exc:
        raise ValueError("Policy observations require numeric arrays") from exc
    if (
        source.layout != torch.strided
        or source.is_complex()
        or source.dtype == torch.bool
        or not torch.isfinite(source).all()
    ):
        raise ValueError("Policy observations require finite real arrays")
    result = source.detach().to(dtype=dtype).clone()
    if not torch.isfinite(result).all():
        raise ValueError("Policy observations overflow the native dtype")
    return result


def own_batch(owner, states, actions, rewards):
    parameter = native_parameter(owner)
    states_t = owned_numeric(states, parameter, parameter.dtype)
    actions_t = owned_numeric(actions, parameter, torch.float64)
    rewards_t = owned_numeric(rewards, parameter, parameter.dtype)
    if (
        states_t.ndim != 2
        or states_t.shape[1] != owner.state_dim
        or not 1 <= len(states_t) <= MAX_ROWS
    ):
        raise ValueError("states must be bounded nonempty rows with state_dim features")
    count = len(states_t)
    if rewards_t.shape == (count, 1):
        rewards_t = rewards_t[:, 0]
    if actions_t.shape != (count,) or rewards_t.shape != (count,):
        raise ValueError("actions and rewards must have one value per state row")
    if not torch.equal(actions_t, actions_t.round()):
        raise ValueError("actions must be integer indices")
    if ((actions_t < 0) | (actions_t >= owner.action_dim)).any():
        raise ValueError("action index outside categorical policy")
    return states_t, actions_t.long(), rewards_t


def own_trajectories(owner, trajectories, epochs, batch_size):
    for value, name, maximum in (
        (epochs, "epochs", 1_000),
        (batch_size, "batch_size", MAX_ROWS),
    ):
        if (
            isinstance(value, bool)
            or not isinstance(value, Integral)
            or not 1 <= value <= maximum
        ):
            raise ValueError(f"Policy {name} requires an integer in [1,{maximum}]")
    if (
        not isinstance(trajectories, (list, tuple))
        or not 1 <= len(trajectories) <= MAX_ROWS
    ):
        raise ValueError("Policy trajectories require a bounded nonempty sequence")
    batches, count = [], 0
    for trajectory in trajectories:
        if not isinstance(trajectory, dict) or not all(
            key in trajectory for key in ("states", "actions", "rewards")
        ):
            raise ValueError("Each trajectory requires paired states/actions/rewards")
        batch = own_batch(
            owner, trajectory["states"], trajectory["actions"], trajectory["rewards"]
        )
        count += len(batch[0])
        if count > MAX_ROWS or count * epochs > MAX_ROW_EPOCHS:
            raise ValueError("Policy fitting exceeds its total row/row-epoch budget")
        batches.append(batch)
    states = torch.cat([batch[0] for batch in batches]).cpu().numpy()
    actions = torch.cat([batch[1] for batch in batches]).cpu().numpy()
    rewards = (
        torch.cat([batch[2] for batch in batches]).cpu().numpy().astype(np.float64)
    )
    # Preserve the existing population reward normalization, not per-batch credit.
    rewards = (rewards - np.mean(rewards)) / (np.std(rewards) + 1e-8)
    if not np.isfinite(rewards).all():
        raise ValueError("Normalized policy rewards must be finite")
    return states, actions, rewards, int(epochs), int(batch_size)


def admit_policy_optimizer(owner):
    model, optimizer = owner.policy, owner.optimizer
    if type(optimizer) is not torch.optim.Adam:
        raise ValueError("Policy transitions require ordinary native Adam")
    if any(
        group.get(option, False)
        for group in optimizer.param_groups
        for option in ("fused", "capturable", "differentiable")
    ):
        raise ValueError("Policy transitions require ordinary nonfused Adam")
    validate_optimizer_policy(optimizer)
    parameters = list(model.parameters())
    bound = [p for group in optimizer.param_groups for p in group["params"]]
    if len(parameters) != len(bound) or any(
        a is not b for a, b in zip(parameters, bound)
    ):
        raise ValueError("Policy Adam must bind ordered registered parameters")
    if any(not torch.isfinite(value).all() for value in model.state_dict().values()):
        raise ValueError("Policy logits/registered state must be finite")


def policy_owned(method):
    """Aggregate checkpoint accesses share the policy trainer's native lock."""

    @wraps(method)
    def owned(self, *args, **kwargs):
        with self.policy_gradient._operation_lock:
            return method(self, *args, **kwargs)

    return owned
