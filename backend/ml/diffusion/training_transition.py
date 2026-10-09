"""Owned diffusion observations and checked ordinary native AdamW transitions."""

import copy
import math
from contextlib import contextmanager
from functools import wraps
from numbers import Integral, Real

import torch
from torch import nn

MAX_VALUES = 8_000_000
MAX_WORK = 256_000_000
MAX_STATE = 32_000_000


def integer(value, name, maximum):
    if isinstance(value, bool) or not isinstance(value, Integral) or not 1 <= value <= maximum:
        raise ValueError(f"{name} must be an integer in [1,{maximum}]")
    return int(value)


def owned(method):
    @wraps(method)
    def call(self, *args, **kwargs):
        with self._operation_lock:
            return method(self, *args, **kwargs)
    return call


def observations(model, data, condition=None, epochs=1):
    if not isinstance(data, torch.Tensor):
        raise ValueError("data must be a native tensor")  # noqa: TRY004 - uniform admission
    weight = next(p for p in model.parameters() if not isinstance(p, nn.parameter.UninitializedParameter))
    values = []
    for value in (data, condition):
        if value is None:
            continue
        if (not isinstance(value, torch.Tensor) or value.layout != torch.strided
                or value.ndim not in (2, 3) or any(n == 0 for n in value.shape)
                or value.dtype != weight.dtype or value.device != weight.device
                or value.dtype not in (torch.float32, torch.float64)
                or value.numel() > MAX_VALUES or not torch.isfinite(value).all()):
            raise ValueError("observations must be finite bounded dense model-dtype/device tensors")
        values.append(value)
    if hasattr(model, 'input_dim'):
        if data.ndim != 3 or data.shape[-1] != model.input_dim:
            raise ValueError("native diffusion data must be [rows,sequence,input_dim]")
        if condition is not None:
            if condition.shape[:-1] != data.shape[:-1] and not (
                    condition.ndim == 2 and condition.shape[0] == data.shape[0]):
                raise ValueError("condition rows/sequence must match observations")
            projection = model.cond_proj
            width = None if isinstance(projection.weight, nn.parameter.UninitializedParameter) else projection.weight.shape[1]
            if width is not None and condition.shape[-1] != width:
                raise ValueError("condition width differs from the registered projection")
        h = model.hidden_dim
        layers = len(model.blocks) // 2
        rows, sequence, _ = data.shape
        work = epochs * rows * sequence * (h*h*(3+7*layers) + 2*model.input_dim*h)
        if condition is not None:
            work += epochs * rows * sequence * h * condition.shape[-1]
        heads = model.blocks[1].num_heads if layers else 1
        if (rows > 2048 or sequence > 512 or work > MAX_WORK
                or epochs * layers * rows * heads * sequence * sequence > 32_000_000):
            raise ValueError("observations exceed native training work policy")
    if sum(v.numel() for v in values) > MAX_VALUES:
        raise ValueError("observations exceed the owned value policy")
    if condition is not None and condition.ndim == 2 and data.ndim == 3:
        condition = condition.unsqueeze(1).expand(-1, data.shape[1], -1)
        if data.numel() + condition.numel() > MAX_VALUES:
            raise ValueError("broadcast observations exceed the owned value policy")
    return data.detach().clone(), None if condition is None else condition.detach().clone()



def batches(model, stream):
    """Own a finite loader traversal before its first update, under total limits."""
    result = []
    rows = values = work = 0
    condition_width = None
    for data, condition in stream:
        rows += len(data)
        values += data.numel() + (condition.numel() if condition is not None else 0)
        if hasattr(model, 'input_dim'):
            h = model.hidden_dim
            layers = len(model.blocks) // 2
            work += len(data) * data.shape[1] * (h*h*(3+7*layers) + 2*model.input_dim*h)
            if condition is not None:
                work += len(data) * data.shape[1] * h * condition.shape[-1]
        if rows > 2048 or values > MAX_VALUES or work > MAX_WORK:
            raise ValueError("loader traversal exceeds the owned training policy")
        data, condition = observations(model, data, condition)
        if condition is not None:
            if condition_width is not None and condition.shape[-1] != condition_width:
                raise ValueError("loader condition widths must share one projection")
            condition_width = condition.shape[-1]
        result.append((data, condition))
    if not result:
        raise ValueError("loader traversal must be nonempty")
    return result

def finite_tree(value):
    if isinstance(value, nn.parameter.UninitializedParameter):
        return
    if isinstance(value, torch.Tensor):
        if not torch.isfinite(value).all():
            raise ValueError("native model/optimizer candidate is nonfinite")
    elif isinstance(value, dict):
        for item in value.values():
            finite_tree(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            finite_tree(item)
    elif isinstance(value, Real) and not math.isfinite(value):
        raise ValueError("native model/optimizer policy is nonfinite")


def policy(optimizer):
    if type(optimizer) is not torch.optim.AdamW:
        raise ValueError("checked transitions require ordinary native AdamW")
    for group in optimizer.param_groups:
        for key in ('lr', 'eps', 'weight_decay'):
            value = group[key]
            if isinstance(value, bool) or not isinstance(value, Real) or not math.isfinite(value) or value < 0:
                raise ValueError("AdamW policy must be finite and nonnegative")
        if any(isinstance(v, bool) or not isinstance(v, Real) or not math.isfinite(v) or not 0 <= v < 1 for v in group['betas']):
            raise ValueError("AdamW betas must be finite in [0,1)")
    finite_tree(optimizer.state_dict())


def initialize_condition(model, condition):
    if condition is not None and hasattr(model, 'cond_proj'):
        projection = model.cond_proj
        if isinstance(projection.weight, nn.parameter.UninitializedParameter):
            # Valid native initialization is a separate boundary, not rolled back
            # by a later rejected optimizer step. Registered identities remain.
            existing = sum(p.numel() for p in model.parameters() if not isinstance(p, nn.parameter.UninitializedParameter))
            if existing + projection.out_features * (condition.shape[-1] + 1) > MAX_STATE:
                raise ValueError("condition initialization exceeds snapshot policy")
            projection.initialize_parameters(condition)


@contextmanager
def transition(model, optimizer):
    policy(optimizer)
    finite_tree(model.state_dict())
    sources = {k: v for k, v in model.state_dict().items()
               if not isinstance(v, nn.parameter.UninitializedParameter)}
    if sum(v.numel() for v in sources.values()) > MAX_STATE:
        raise ValueError("native transition exceeds the snapshot policy")
    state = {k: v.detach().clone() for k, v in sources.items()}
    previous = copy.deepcopy(optimizer.state_dict())
    parameters = list(model.parameters())
    gradients = [None if p.grad is None else p.grad.detach().clone() for p in parameters]
    modes = [(module, module.training) for module in model.modules()]
    try:
        yield
        finite_tree(model.state_dict())
        policy(optimizer)
    except Exception:
        with torch.no_grad():
            current = model.state_dict()
            for key, value in state.items():
                current[key].copy_(value)
        optimizer.load_state_dict(previous)
        for p, gradient in zip(parameters, gradients):
            p.grad = gradient
        for module, mode in modes:
            module.training = mode
        raise
