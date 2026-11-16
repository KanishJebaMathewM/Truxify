"""Owned finite native PINN/Adam step publication, retaining accepted batches."""

import copy
import math
from functools import wraps
from numbers import Real

import torch


class PINNInputError(ValueError):
    """The caller's complete training observations or loop controls are invalid."""


class PINNTransitionError(ValueError):
    """The native model/Adam state cannot publish a finite training candidate."""


def owned_operation(method):
    @wraps(method)
    def operation(self, *args, **kwargs):
        with self._operation_lock:
            return method(self, *args, **kwargs)
    return operation


def finite_state(trainer):
    for value in trainer.model.state_dict().values():
        if not torch.isfinite(value).all():
            raise PINNTransitionError('native PINN model candidate must remain finite')
    for parameter, entry in trainer.optimizer.state.items():
        if not isinstance(entry, dict):
            raise PINNTransitionError('native Adam state must contain compatible moments')
        required = {'step', 'exp_avg', 'exp_avg_sq'}
        if trainer.optimizer.param_groups[0]['amsgrad']:
            required.add('max_exp_avg_sq')
        if set(entry) != required:
            raise PINNTransitionError('native Adam moment schema must match execution policy')
        for name, value in entry.items():
            if not isinstance(value, torch.Tensor) or not torch.isfinite(value).all():
                raise PINNTransitionError('native Adam candidate moments must remain finite')
            if name == 'step':
                if value.numel() != 1 or value.item() < 0 or value.item() != int(value.item()):
                    raise PINNTransitionError('native Adam step must be a nonnegative integer scalar')
            elif (value.shape != parameter.shape or value.dtype != parameter.dtype or value.device != parameter.device
                  or (name != 'exp_avg' and (value < 0).any())):
                raise PINNTransitionError('native Adam moments must match parameter geometry')


def admit_optimizer(trainer):
    parameters = tuple(trainer.model.parameters())
    if not parameters or not isinstance(trainer.optimizer, torch.optim.Adam):
        raise PINNTransitionError('native PINN training requires registered parameters and Adam')
    reference = parameters[0]
    if reference.dtype not in (torch.float32, torch.float64) or reference.device.type not in ('cpu', 'cuda'):
        raise PINNTransitionError('native PINN training requires float32/64 CPU or CUDA')
    if any(p.dtype != reference.dtype or p.device != reference.device or not p.requires_grad for p in parameters):
        raise PINNTransitionError('native PINN parameters must share trainable dtype/device')
    if len(trainer.optimizer.param_groups) != 1:
        raise PINNTransitionError('native PINN trainer requires one coherent Adam group')
    group = trainer.optimizer.param_groups[0]
    if tuple(map(id, group['params'])) != tuple(map(id, parameters)):
        raise PINNTransitionError('native Adam must own the registered PINN parameter order')
    if any(not any(parameter is p for p in parameters) for parameter in trainer.optimizer.state):
        raise PINNTransitionError('native Adam state references an unregistered parameter')
    for name in ('lr', 'eps', 'weight_decay'):
        value = group[name]
        if isinstance(value, bool) or not isinstance(value, Real) or not math.isfinite(value) or value < 0:
            raise PINNTransitionError('native Adam policy must be finite and nonnegative')
    betas = group['betas']
    if (not isinstance(betas, (list, tuple)) or len(betas) != 2
            or any(isinstance(v, bool) or not isinstance(v, Real) or not math.isfinite(v) or not 0 <= v < 1 for v in betas)):
        raise PINNTransitionError('native Adam betas must lie in [0,1)')
    for name in ('amsgrad', 'maximize', 'capturable', 'differentiable', 'decoupled_weight_decay'):
        if name in group and type(group[name]) is not bool:
            raise PINNTransitionError('native Adam flags must be booleans')
    if any(group.get(name, False) for name in ('capturable', 'differentiable', 'decoupled_weight_decay')):
        raise PINNTransitionError('native PINN requires ordinary noncapturable Adam')
    for name in ('foreach', 'fused'):
        if group.get(name) is not None and type(group[name]) is not bool:
            raise PINNTransitionError('native Adam execution flags must be boolean or None')
    if group.get('foreach') and group.get('fused'):
        raise PINNTransitionError('native Adam foreach and fused cannot both be enabled')
    finite_state(trainer)


def checked_transition(method):
    @wraps(method)
    def step(self, *args, **kwargs):
        with self._operation_lock:
            admit_optimizer(self)
            weights = copy.deepcopy(self.model.state_dict())
            moments = copy.deepcopy(self.optimizer.state_dict())
            scheduler = copy.deepcopy(self.scheduler.state_dict())
            parameters = tuple(self.model.parameters())
            gradients = [None if p.grad is None else p.grad.detach().clone() for p in parameters]
            modes = [(module, module.training) for module in self.model.modules()]
            try:
                result = method(self, *args, **kwargs)
                finite_state(self)
                return result
            except Exception:
                self.model.load_state_dict(weights)
                self.optimizer.load_state_dict(moments)
                self.scheduler.load_state_dict(scheduler)
                for parameter, gradient in zip(parameters, gradients):
                    parameter.grad = gradient
                for module, training in modes:
                    module.training = training
                raise
    return step


def loop_policy(trainer, data_rows, physics_rows, epochs, batch_size):
    if (type(epochs) is not int or not 1 <= epochs <= 1000
            or type(batch_size) is not int or not 1 <= batch_size <= 4096):
        raise PINNInputError('epochs and batch_size must be bounded positive integers')
    batches = (data_rows + batch_size - 1) // batch_size
    points = data_rows + batches * min(batch_size, physics_rows)
    if points * epochs > 2000000 or points * epochs * sum(p.numel() for p in trainer.model.parameters()) > 200000000:
        raise PINNInputError('native PINN training exceeds admitted row/epoch/parameter work')
