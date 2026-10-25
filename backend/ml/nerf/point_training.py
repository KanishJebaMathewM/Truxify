"""Complete pointwise observations; ray origins are a distinct named objective."""

import math
from numbers import Integral

import torch
from foundation.optimizer_transition import validate_optimizer_policy

MAX_POINTS = 100_000
MAX_POINT_EPOCHS = 10_000_000


def count(value, name, maximum):
    if isinstance(value, bool) or not isinstance(value, Integral) or not 1 <= value <= maximum:
        raise ValueError(f'{name} must be an integer in [1, {maximum}]')
    return int(value)


def own_points(points, directions, rgb, model, epochs=1, batch_size=4096):
    epochs = count(epochs, 'epochs', 100)
    count(batch_size, 'batch_size', MAX_POINTS)
    parameter = next(model.parameters())
    if parameter.dtype not in (torch.float32, torch.float64) or parameter.device.type not in ('cpu', 'cuda'):
        raise ValueError('pointwise fitting requires a float32/64 CPU or CUDA model')
    values = (points, directions, rgb)
    for value in values:
        if (not isinstance(value, torch.Tensor) or value.layout != torch.strided
                or value.dtype != parameter.dtype or value.ndim != 2 or value.size(1) != 3
                or not torch.isfinite(value).all()):
            raise ValueError('point/direction/RGB require finite model-compatible [points, 3] tensors')
    if any(value.shape != points.shape for value in values):
        raise ValueError('point/direction/RGB collections require matching rows')
    rows = count(len(points), 'points', MAX_POINTS)
    if rows * epochs > MAX_POINT_EPOCHS:
        raise ValueError('pointwise fitting exceeds its point-epoch budget')
    if not ((rgb >= 0) & (rgb <= 1)).all():
        raise ValueError('pointwise target RGB must lie in [0, 1]')
    for value, encoder in ((points, model.pos_encoder), (directions, model.dir_encoder)):
        if encoder.num_frequencies:
            scale = (2 ** (encoder.num_frequencies - 1)) * math.pi
            if not (value.abs() <= torch.finfo(parameter.dtype).max / scale).all():
                raise ValueError('complete Fourier inputs must be finitely representable')
    return tuple(value.detach().to(parameter.device).clone() for value in values)


def admit_adam(model, optimizer):
    """Reject invalid prior native state before collection shuffling."""
    if type(optimizer) is not torch.optim.Adam:
        raise ValueError('pointwise transition requires native Adam')
    validate_optimizer_policy(optimizer)
    if any(not torch.isfinite(value).all() for value in model.state_dict().values()):
        raise ValueError('native field prior state must be finite')
