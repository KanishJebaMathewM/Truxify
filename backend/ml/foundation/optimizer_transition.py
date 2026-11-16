"""Finite native optimizer transitions with process-local operation ownership."""

import copy
import math
from contextlib import contextmanager
from functools import wraps
from numbers import Integral, Real

import torch


def finite_policy_number(value, name):
    """Admit a real scalar policy value without changing native optimizer math."""
    if isinstance(value, torch.Tensor):
        if value.numel() != 1 or value.is_complex() or value.dtype == torch.bool:
            raise ValueError(f"{name} must be a finite real scalar")
        value = value.item()
    if (
        isinstance(value, bool)
        or not isinstance(value, Real)
        or not math.isfinite(value)
    ):
        raise ValueError(f"{name} must be a finite real scalar")
    return float(value)


def _finite_tree(value):
    if isinstance(value, torch.Tensor):
        if not torch.isfinite(value).all():
            raise ValueError("Model/optimizer transition contains a nonfinite tensor")
    elif isinstance(value, dict):
        for item in value.values():
            _finite_tree(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            _finite_tree(item)
    elif isinstance(value, Real) and not math.isfinite(value):
        raise ValueError("Model/optimizer transition contains a nonfinite number")


def validate_optimizer_policy(optimizer):
    for group in optimizer.param_groups:
        for key in ("lr", "eps", "weight_decay"):
            if finite_policy_number(group[key], key) < 0:
                raise ValueError(f"{key} must be nonnegative")
        for beta in group["betas"]:
            if not 0 <= finite_policy_number(beta, "beta") < 1:
                raise ValueError("AdamW beta must lie in [0,1)")
    _finite_tree(optimizer.state_dict())


def validate_scheduler_policy(scheduler, optimizer):
    """Admit the ordinary native cosine scheduler bound to this optimizer."""
    if type(scheduler) is not torch.optim.lr_scheduler.CosineAnnealingLR:
        raise ValueError("supervised transition requires native CosineAnnealingLR")
    if type(optimizer) is not torch.optim.AdamW or scheduler.optimizer is not optimizer:
        raise ValueError("cosine scheduler must own the trainer's native AdamW")
    for key, minimum in (("T_max", 1), ("last_epoch", 0), ("_step_count", 1)):
        value = getattr(scheduler, key)
        if isinstance(value, bool) or not isinstance(value, Integral) or value < minimum:
            raise ValueError(f"cosine {key} must be an integer >= {minimum}")
    if finite_policy_number(scheduler.eta_min, "eta_min") < 0:
        raise ValueError("cosine eta_min must be nonnegative")
    for key in ("base_lrs", "_last_lr"):
        values = getattr(scheduler, key)
        if len(values) != len(optimizer.param_groups):
            raise ValueError(f"cosine {key} must match optimizer groups")
        for value in values:
            if finite_policy_number(value, key) < 0:
                raise ValueError(f"cosine {key} must be nonnegative")
    _finite_tree(scheduler.state_dict())


def operation_owned(method):
    """Serialize operations on this trainer, including nested train steps."""

    @wraps(method)
    def owned(self, *args, **kwargs):
        with self._operation_lock:
            return method(self, *args, **kwargs)

    return owned


@contextmanager
def optimizer_transition(model, optimizer, scheduler=None):
    """Restore exact prior native state after exceptional/nonfinite work."""
    validate_optimizer_policy(optimizer)
    _finite_tree(model.state_dict())
    if scheduler is not None:
        validate_scheduler_policy(scheduler, optimizer)
    scheduler_before = None if scheduler is None else copy.deepcopy(scheduler.state_dict())
    model_before = copy.deepcopy(model.state_dict())
    optimizer_before = copy.deepcopy(optimizer.state_dict())
    gradients = [
        None if p.grad is None else p.grad.detach().clone() for p in model.parameters()
    ]
    modes = [(module, module.training) for module in model.modules()]
    try:
        yield
        _finite_tree(model.state_dict())
        validate_optimizer_policy(optimizer)
        if scheduler is not None:
            validate_scheduler_policy(scheduler, optimizer)
            if (scheduler.last_epoch != scheduler_before["last_epoch"] + 1
                    or scheduler._step_count != scheduler_before["_step_count"] + 1
                    or list(scheduler.get_last_lr()) != [g["lr"] for g in optimizer.param_groups]):
                raise ValueError("cosine scheduler did not publish one coherent native step")
    except Exception:
        model.load_state_dict(model_before)
        optimizer.load_state_dict(optimizer_before)
        if scheduler is not None:
            scheduler.load_state_dict(scheduler_before)
        for parameter, gradient in zip(model.parameters(), gradients):
            parameter.grad = gradient
        for module, mode in modes:
            module.training = mode
        raise
