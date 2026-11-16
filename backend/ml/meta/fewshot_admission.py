"""Complete owned few-shot observations and finite native adaptation candidates."""

import math

import numpy as np
import torch


class FewShotInputError(ValueError):
    """The caller does not define an admitted complete few-shot operation."""


class FewShotTransitionError(RuntimeError):
    """Native adaptation or prediction did not produce a finite candidate."""


def reference(model, steps, inner_lr):
    if type(steps) is not int or not 1 <= steps <= 32:
        raise FewShotInputError('steps must be an integer in [1,32]')
    if type(inner_lr) not in (int, float) or not math.isfinite(inner_lr) or inner_lr < 0:
        raise FewShotTransitionError('inner learning rate must be finite and nonnegative')
    parameter = next(model.parameters())
    if parameter.dtype not in (torch.float32, torch.float64) or parameter.device.type not in ('cpu', 'cuda'):
        raise FewShotTransitionError('few-shot inference requires float32/64 CPU or CUDA model state')
    for value in model.state_dict().values():
        checked(value, 'native model state')
    return parameter


def checked(value, name):
    if not isinstance(value, torch.Tensor) or not torch.isfinite(value).all():
        raise FewShotTransitionError(f'{name} must remain finite')
    return value


def own(value, parameter, name):
    if isinstance(value, torch.Tensor):
        if value.layout != torch.strided or value.is_complex() or value.dtype == torch.bool:
            raise FewShotInputError(f'{name} must be dense real observations')
        raw = value
    else:
        try:
            raw = np.asarray(value)
        except (ValueError, TypeError, OverflowError) as exc:
            raise FewShotInputError(f'{name} must be rectangular real observations') from exc
        if raw.dtype.kind not in 'iuf':
            raise FewShotInputError(f'{name} must be real numeric observations')
    count = raw.size if isinstance(raw, np.ndarray) else raw.numel()
    if count > 1048576:
        raise FewShotInputError('few-shot observations exceed the value budget')
    try:
        # Tensor cloning retains differentiable input links for direct adapt;
        # public NumPy observations carry no caller autograd graph.
        result = (raw.to(device=parameter.device, dtype=parameter.dtype).clone() if isinstance(raw, torch.Tensor)
                  else torch.tensor(raw, device=parameter.device, dtype=parameter.dtype))
    except (ValueError, TypeError, OverflowError, RuntimeError) as exc:
        raise FewShotInputError(f'{name} cannot be represented in model dtype') from exc
    if not torch.isfinite(result).all():
        raise FewShotInputError(f'{name} must be finitely representable')
    return result


def features(value, parameter, model, name):
    value = own(value, parameter, name)
    if value.ndim != 2 or not 1 <= len(value) <= 4096 or value.shape[1] != model.input_dim:
        raise FewShotInputError(f'{name} must contain nonempty paired input_dim rows')
    return value


def support(model, x, y, steps, inner_lr):
    parameter = reference(model, steps, inner_lr)
    x = features(x, parameter, model, 'support features')
    y = own(y, parameter, 'support targets')
    if y.ndim == 1 and model.output_dim == 1:
        y = y[:, None]
    if y.shape != (len(x), model.output_dim):
        raise FewShotInputError('Support/query targets must match prediction rows and outputs')
    if (x.numel() + y.numel() > 1048576
            or len(x) * steps * sum(p.numel() for p in model.parameters()) > 64000000):
        raise FewShotInputError('native adaptation exceeds the bounded work budget')
    return x, y


def complete(maml, x, y, query, steps):
    x, y = support(maml.model, x, y, steps, maml.inner_lr)
    parameter = next(maml.model.parameters())
    query = features(query, parameter, maml.model, 'query features')
    if len(query) * sum(p.numel() for p in maml.model.parameters()) > 64000000:
        raise FewShotInputError('native query exceeds the bounded work budget')
    if x.numel() + y.numel() + query.numel() > 1048576:
        raise FewShotInputError('complete few-shot observations exceed the value budget')
    return x, y, query


def predict_owned(learner, x, y, query, steps):
    with learner.maml._generation_lock:
        x, y, query = complete(learner.maml, x, y, query, steps)
        adapted = learner.maml.adapt(x, y, steps, training=False)
        predictions = checked(learner.maml.predict(adapted, query), 'native query predictions')
        if predictions.shape != (len(query), learner.maml.model.output_dim):
            raise FewShotTransitionError('native query predictions must retain query row identity')
        return predictions.detach().cpu().numpy().copy()


def classify_owned(learner, support_set, query, steps):
    # This repository's scalar MSE head and task sampler implement binary
    # regression scores. Arbitrary ordinal labels are not a multiclass model.
    if not isinstance(support_set, dict) or set(support_set) != {'0', '1'}:
        raise FewShotInputError('scalar few-shot classification requires exactly classes 0 and 1')
    with learner.maml._generation_lock:
        if learner.maml.model.output_dim != 1:
            raise FewShotInputError('binary few-shot classification requires one scalar score')
        parameter = reference(learner.maml.model, steps, learner.maml.inner_lr)
        groups = [features(support_set[label], parameter, learner.maml.model, 'class support') for label in ('0', '1')]
        if sum(len(group) for group in groups) > 4096 or sum(group.numel() for group in groups) > 1048576:
            raise FewShotInputError('combined class support exceeds admitted capacity')
        x = torch.cat(groups)
        y = torch.cat([torch.full((len(group), 1), label, device=parameter.device, dtype=parameter.dtype)
                       for label, group in enumerate(groups)])
        scores = predict_owned(learner, x, y, query, steps)
        # Preserve the existing binary midpoint tie (round(0.5)==0), while
        # preventing unbounded regression scores from inventing categories.
        return (scores[:, 0] > .5).astype(np.int64)
