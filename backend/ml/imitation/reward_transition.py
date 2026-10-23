"""Owned native reward observations and reward-component operation ownership."""

from functools import wraps
from numbers import Integral

import numpy as np
import torch
from foundation.optimizer_transition import validate_optimizer_policy

MAX_ROWS = 10_000
MAX_ROW_EPOCHS = 2_000_000


def own_population(owner, states, actions):
    parameter = next(owner.reward_model.parameters())
    if parameter.dtype not in (
        torch.float32,
        torch.float64,
    ) or parameter.device.type not in ("cpu", "cuda"):
        raise ValueError("Reward observations require a float32/64 CPU or CUDA model")
    tensors = []
    for value, width in ((states, owner.state_dim), (actions, owner.action_dim)):
        try:
            tensor = torch.as_tensor(
                value if isinstance(value, torch.Tensor) else np.asarray(value),
                device=parameter.device,
            )
        except (ValueError, TypeError, RuntimeError) as exc:
            raise ValueError(
                "Reward observations require numeric paired matrices"
            ) from exc
        if (
            tensor.layout != torch.strided
            or tensor.is_complex()
            or tensor.dtype == torch.bool
            or tensor.ndim != 2
            or tensor.shape[1] != width
            or not 1 <= len(tensor) <= MAX_ROWS
            or not torch.isfinite(tensor).all()
        ):
            raise ValueError(
                "Reward observations require finite compatible nonempty matrices"
            )
        tensor = tensor.detach().to(dtype=parameter.dtype).clone()
        if not torch.isfinite(tensor).all():
            raise ValueError("Reward observations overflow the native model dtype")
        tensors.append(tensor)
    if len(tensors[0]) != len(tensors[1]):
        raise ValueError("State/action rows must remain paired within each population")
    return torch.cat(tensors, dim=-1)


def own_populations(
    owner, expert_states, expert_actions, learner_states, learner_actions, epochs
):
    if (
        isinstance(epochs, bool)
        or not isinstance(epochs, Integral)
        or not 1 <= epochs <= 1_000
    ):
        raise ValueError("Reward epochs require an integer in [1,1000]")
    expert = own_population(owner, expert_states, expert_actions)
    learner = own_population(owner, learner_states, learner_actions)
    if (len(expert) + len(learner)) * epochs > MAX_ROW_EPOCHS:
        raise ValueError("Reward fitting exceeds the row-epoch admission budget")
    return expert, learner, int(epochs)


def admit_reward_optimizer(owner):
    model, optimizer = owner.reward_model, owner.optimizer
    if type(optimizer) is not torch.optim.Adam:
        raise ValueError("Reward transitions require ordinary native Adam")
    validate_optimizer_policy(optimizer)
    parameters = list(model.parameters())
    bound = [p for g in optimizer.param_groups for p in g["params"]]
    if len(parameters) != len(bound) or any(
        a is not b for a, b in zip(parameters, bound)
    ):
        raise ValueError("Reward Adam must bind ordered registered parameters")
    if any(not torch.isfinite(value).all() for value in model.state_dict().values()):
        raise ValueError("Reward registered state must be finite")


def reward_owned(method):
    """Aggregate checkpoint operations share the reward trainer's existing lock."""

    @wraps(method)
    def owned(self, *args, **kwargs):
        with self.inverse_rl._operation_lock:
            return method(self, *args, **kwargs)

    return owned
