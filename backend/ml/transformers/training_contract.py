"""Owned complete fitting collections and finite private native generations."""

from numbers import Integral

import torch
from foundation.optimizer_transition import validate_optimizer_policy

MAX_ROWS = 10_000
MAX_ELEMENTS = 2_000_000
MAX_ELEMENT_EPOCHS = 100_000_000


class ForecastAdmissionError(ValueError):
    """A client fitting collection/policy cannot enter native work."""


def _count(value, name, maximum):
    if isinstance(value, bool) or not isinstance(value, Integral) or not 1 <= value <= maximum:
        raise ForecastAdmissionError(f'{name} must be an integer in [1, {maximum}]')
    return int(value)


def _own(value, parameter, name, inputs=False):
    input_dtypes = (torch.float32, torch.float64, torch.int8, torch.int16, torch.int32, torch.int64, torch.uint8)
    if (not isinstance(value, torch.Tensor) or value.layout != torch.strided
            or (value.dtype not in input_dtypes if inputs else value.dtype != parameter.dtype)
            or value.ndim < 1 or 0 in value.shape
            or not torch.isfinite(value).all()):
        raise ForecastAdmissionError(f'{name} requires a nonempty finite compatible floating tensor')
    if value.size(0) > MAX_ROWS or value.numel() > MAX_ELEMENTS:
        raise ForecastAdmissionError(f'{name} exceeds collection admission bounds')
    return value.detach().to(parameter.device).clone()


def own_collections(model, x, y, vx, vy, epochs, batch_size):
    epochs, batch_size = _count(epochs, 'epochs', 500), _count(batch_size, 'batch_size', MAX_ROWS)
    if (vx is None) != (vy is None):
        raise ForecastAdmissionError('validation inputs and labels must be provided together')
    parameter = next(model.parameters())
    if parameter.dtype not in (torch.float32, torch.float64) or parameter.device.type not in ('cpu', 'cuda'):
        raise ForecastAdmissionError('fitting requires a float32/64 CPU or CUDA model')
    owned = [_own(x, parameter, 'train_data', inputs=True), _own(y, parameter, 'train_labels')]
    owned += [None, None] if vx is None else [_own(vx, parameter, 'val_data', inputs=True), _own(vy, parameter, 'val_labels')]
    elements = sum(value.numel() for value in owned if value is not None)
    if elements > MAX_ELEMENTS or elements * epochs > MAX_ELEMENT_EPOCHS:
        raise ForecastAdmissionError('complete fitting exceeds scalar element/epoch admission bounds')
    family = getattr(model, 'transformer', model)
    known = all(hasattr(family, key) for key in ('input_dim', 'pred_len', 'pos_encoding'))
    for inputs, labels in ((owned[0], owned[1]), (owned[2], owned[3])):
        if inputs is None:
            continue
        if inputs.size(0) != labels.size(0):
            raise ForecastAdmissionError('input and target row counts must match')
        if known and (inputs.dtype != parameter.dtype or inputs.ndim != 3 or inputs.size(2) != family.input_dim
                      or inputs.size(1) > family.pos_encoding.pe.size(0)
                      or labels.shape != (inputs.size(0), family.pred_len)):
            raise ForecastAdmissionError('native family inputs/features/sequence and forecast target horizons must match')
    return (*owned, epochs, batch_size)


def admit_state(model, optimizer):
    if type(optimizer) is not torch.optim.AdamW:
        raise ValueError('finite fitting requires native AdamW')
    validate_optimizer_policy(optimizer)
    if any(not torch.isfinite(value).all() for value in model.state_dict().values()):
        raise ValueError('native fitting generation contains nonfinite registered state')


def checked_predictions(predictions, labels):
    if not isinstance(predictions, torch.Tensor) or predictions.shape != labels.shape:
        raise ForecastAdmissionError('actual native forecast outputs must match target shape without broadcasting')
    if not torch.isfinite(predictions).all():
        raise ValueError('native forecast predictions must be finite')


def checked_loss(loss):
    if not isinstance(loss, torch.Tensor) or loss.ndim != 0 or not torch.isfinite(loss):
        raise ValueError('native fitting objective must be a finite scalar')


def request_tensors(request):
    """Rectangular conversion at the existing three client training boundaries."""
    try:
        values = [torch.tensor(value, dtype=torch.float32) for value in (request.train_data, request.train_labels)]
        values += [None, None] if request.val_data is None else [
            torch.tensor(request.val_data, dtype=torch.float32),
            torch.tensor(request.val_labels, dtype=torch.float32)]
    except (TypeError, ValueError, RuntimeError) as exc:
        raise ForecastAdmissionError('training collections must be rectangular numerical tensors') from exc
    return values


def check_candidate_observations(model, criterion, collections, batch_size):
    """Finite registered weights alone do not establish finite native forecasts."""
    model.eval()
    with torch.no_grad():
        for inputs, labels in collections:
            if inputs is None:
                continue
            for start in range(0, len(inputs), batch_size):
                targets = labels[start:start + batch_size]
                predictions = model(inputs[start:start + batch_size])
                checked_predictions(predictions, targets)
                checked_loss(criterion(predictions, targets))
