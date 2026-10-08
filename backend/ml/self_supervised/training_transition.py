"""Owned SSL admission and one native AdamW recovery boundary."""

import copy
import math
from contextlib import contextmanager

import torch

MAX_VALUES = 8_000_000
MAX_WORK = 500_000_000
MAX_LOGIT_VALUES = 16_000_000


class SSLAdmissionError(ValueError):
    """An observation or invocation policy cannot enter native pretraining."""


def counts(rows, epochs, batch_size, width, method=None, queue_size=0):
    for name, value, maximum in [('rows', rows, 10_000), ('epochs', epochs, 100),
                                  ('batch_size', batch_size, 8192)]:
        if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= maximum:
            raise SSLAdmissionError(f'{name} must be an integer in [1, {maximum}]')
    if rows * width > MAX_VALUES or rows * width * epochs > MAX_WORK:
        raise SSLAdmissionError('pretraining exceeds admitted observation/work budget')
    full, tail = divmod(rows, batch_size)
    peak_rows = min(rows, batch_size)
    if method == 'simclr':
        peak = 4 * peak_rows ** 2
        work = 4 * (full * batch_size ** 2 + tail ** 2) * epochs
    elif method == 'moco':
        if isinstance(queue_size, bool) or not isinstance(queue_size, int) or queue_size < 1:
            raise ValueError('native MoCo capacity must be a positive integer')
        peak = peak_rows * (queue_size + 1)
        work = rows * (queue_size + 1) * epochs
    else:
        peak = work = 0
    if peak > MAX_LOGIT_VALUES or work > MAX_WORK:
        raise SSLAdmissionError('pretraining exceeds peak/logit-work budget')


def own_dataset(data, model, method, epochs, batch_size):
    if not isinstance(data, torch.Tensor) or data.layout != torch.strided:
        raise SSLAdmissionError('data must be a strided native tensor')
    rank = 3 if method == 'mae' else 2
    if data.ndim != rank or not data.size(0) or data.size(-1) != model.input_dim:
        raise SSLAdmissionError('data geometry does not match the selected SSL method')
    width = data[0].numel()
    if not width:
        raise SSLAdmissionError('observations must not be empty')
    counts(len(data), epochs, batch_size, width, method, getattr(model, 'queue_size', 0))
    parameter = next(model.parameters())
    if parameter.device.type not in ('cpu', 'cuda') or parameter.dtype not in (torch.float16, torch.bfloat16, torch.float32, torch.float64):
        raise SSLAdmissionError('SSL training requires supported real CPU or CUDA model state')
    if data.dtype != parameter.dtype or not data.is_floating_point() or not torch.isfinite(data).all():
        raise SSLAdmissionError('data must be finite floating values matching model dtype')
    owned = data.detach().to(parameter.device).clone()
    if method == 'mae':
        model._validate_input(owned)
    return owned


def finite_registered_state(model):
    values = model.state_dict()
    if sum(value.numel() for value in values.values()) > MAX_VALUES:
        raise ValueError('registered SSL state exceeds recovery budget')
    for value in values.values():
        if value.layout != torch.strided or (value.is_floating_point() and not torch.isfinite(value).all()):
            raise ValueError('registered SSL state must be finite and strided')


def check_adam(model, optimizer):
    if type(optimizer) is not torch.optim.AdamW:
        raise ValueError('SSL transitions require the registered native AdamW')
    parameters = list(model.parameters())
    admitted = [p for group in optimizer.param_groups for p in group['params']]
    if len(admitted) != len(parameters) or {id(p) for p in admitted} != {id(p) for p in parameters}:
        raise ValueError('AdamW must own exactly the registered model parameters')
    if len({id(p) for p in admitted}) != len(admitted):
        raise ValueError('AdamW parameters cannot be repeated')
    for group in optimizer.param_groups:
        for name in ('lr', 'eps', 'weight_decay'):
            value = group[name]
            if (isinstance(value, bool) or not isinstance(value, (int, float))
                    or not math.isfinite(value) or value < 0 or (name == 'eps' and value == 0)):
                raise ValueError('AdamW scalar policy must be finite and nonnegative with positive eps')
        if len(group['betas']) != 2 or any(not isinstance(b, (int, float)) or isinstance(b, bool)
                                         or not math.isfinite(b) or not 0 <= b < 1 for b in group['betas']):
            raise ValueError('AdamW betas must be finite in [0, 1)')
    if sum(v.numel() for state in optimizer.state.values() for v in state.values() if isinstance(v, torch.Tensor)) > 3 * MAX_VALUES:
        raise ValueError('AdamW moments exceed recovery budget')
    parameter_ids = {id(p) for p in parameters}
    for parameter, state in optimizer.state.items():
        if id(parameter) not in parameter_ids:
            raise ValueError('AdamW has state for an unrelated parameter')
        if not state:
            continue
        required = {'step', 'exp_avg', 'exp_avg_sq'}
        if not required.issubset(state) or not set(state).issubset(required | {'max_exp_avg_sq'}):
            raise ValueError('AdamW state is incomplete')
        for name, value in state.items():
            if not isinstance(value, torch.Tensor) or value.layout != torch.strided or not torch.isfinite(value).all():
                raise ValueError('AdamW moments must be finite native tensors')
            if name == 'step':
                if value.ndim != 0 or value.dtype not in (torch.float32, torch.float64) or value.item() < 0 or value.item() != int(value.item()):
                    raise ValueError('AdamW step must be a nonnegative integral scalar')
            elif (value.shape != parameter.shape or value.dtype != parameter.dtype
                  or value.device != parameter.device or (name in ('exp_avg_sq', 'max_exp_avg_sq') and (value < 0).any())):
                raise ValueError('AdamW moments must match parameter geometry and variance')
        group = next(g for g in optimizer.param_groups if any(p is parameter for p in g['params']))
        if group['amsgrad'] and 'max_exp_avg_sq' not in state:
            raise ValueError('AMSGrad maximum variance is missing')


@contextmanager
def recover_batch(model, optimizer):
    finite_registered_state(model)
    check_adam(model, optimizer)
    registered = copy.deepcopy(model.state_dict())
    adam = copy.deepcopy(optimizer.state_dict())
    gradients = [None if p.grad is None else p.grad.detach().clone() for p in model.parameters()]
    modes = [(module, module.training) for module in model.modules()]
    receipt = {'accepted': False}
    try:
        yield receipt
        if receipt['accepted']:
            finite_registered_state(model)
            check_adam(model, optimizer)
    except Exception:
        receipt['accepted'] = False
        raise
    finally:
        if not receipt['accepted']:
            model.load_state_dict(registered)
            optimizer.load_state_dict(adam)
            for parameter, gradient in zip(model.parameters(), gradients):
                parameter.grad = gradient
            for module, training in modes:
                module.training = training
