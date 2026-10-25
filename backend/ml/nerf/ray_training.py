"""Complete owned ray/RGB observations for the native rendered-pixel objective."""

import math
from numbers import Real

import torch

MAX_RAYS = 10_000
MAX_QUERY_SAMPLES = 262_144
MAX_SAMPLE_WORK = 128_000_000


class RayAdmissionError(ValueError):
    """Ray observations or invocation policy cannot enter native fitting."""


def count(value, name, low, high):
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise RayAdmissionError(f'{name} must be an integer in [{low}, {high}]')
    return value


def policy(rows, epochs, batch_size, num_samples, near, far):
    count(rows, 'ray count', 1, MAX_RAYS)
    count(epochs, 'epochs', 1, 100)
    count(batch_size, 'batch_size', 1, 4096)
    count(num_samples, 'num_samples', 2, 256)
    if (isinstance(near, bool) or isinstance(far, bool) or not isinstance(near, Real)
            or not isinstance(far, Real) or not math.isfinite(near) or not math.isfinite(far)
            or not 0 <= near < far):
        raise RayAdmissionError('ray interval requires finite 0 <= near < far')
    if min(rows, batch_size) * num_samples > MAX_QUERY_SAMPLES or rows * num_samples * epochs > MAX_SAMPLE_WORK:
        raise RayAdmissionError('ray fitting exceeds query/sample-epoch admission budget')


def own_observations(data, model, epochs, batch_size, num_samples, near, far):
    if not isinstance(data, dict) or not {'origins', 'directions', 'rgb'}.issubset(data):
        raise RayAdmissionError('ray data requires origins, directions and rgb')
    parameter = next(model.parameters())
    if parameter.device.type not in ('cpu', 'cuda') or parameter.dtype not in (torch.float32, torch.float64):
        raise RayAdmissionError('ray fitting requires float32/64 CPU or CUDA model state')
    values = [data[name] for name in ('origins', 'directions', 'rgb')]
    for value in values:
        if (not isinstance(value, torch.Tensor) or value.layout != torch.strided
                or value.ndim != 2 or value.size(1) != 3 or not value.size(0)
                or value.dtype != parameter.dtype or not torch.isfinite(value).all()):
            raise RayAdmissionError('ray observations require finite compatible [rays, 3] floating tensors')
    if any(value.shape != values[0].shape for value in values):
        raise RayAdmissionError('ray origins/directions/RGB must have identical row geometry')
    policy(len(values[0]), epochs, batch_size, num_samples, near, far)
    origins, directions, rgb = [value.detach().to(parameter.device).clone() for value in values]
    lengths = torch.linalg.vector_norm(directions, dim=-1)
    if not torch.isfinite(lengths).all() or not (lengths > 0).all():
        raise RayAdmissionError('ray directions must have representable nonzero lengths')
    if not ((rgb >= 0) & (rgb <= 1)).all():
        raise RayAdmissionError('target RGB must be in [0, 1]')
    endpoints = torch.tensor([near, far], device=parameter.device, dtype=parameter.dtype)
    sampled = origins[:, None, :] + directions[:, None, :] * endpoints[None, :, None]
    if not torch.isfinite(endpoints).all() or not torch.isfinite(sampled).all():
        raise RayAdmissionError('complete sampled ray endpoints must be finitely representable')
    frequencies = model.pos_encoder.num_frequencies
    if frequencies:
        largest = (2 ** (frequencies - 1)) * math.pi
        if not (sampled.abs() <= torch.finfo(parameter.dtype).max / largest).all():
            raise RayAdmissionError('complete positional encoding endpoints must be finitely representable')
    return {'origins': origins, 'directions': directions, 'rgb': rgb}


def fit_rays(trainer, data, epochs, batch_size, num_samples, near, far, renderer_type):
    if not torch.is_grad_enabled():
        raise RayAdmissionError('ray fitting requires an enabled native autograd context')
    data = own_observations(data, trainer.model, epochs, batch_size, num_samples, near, far)
    renderer = renderer_type(trainer.model, near, far, num_samples, trainer.device)
    losses = []
    for _ in range(epochs):
        order = torch.randperm(len(data['origins']), device=data['origins'].device)
        total = 0.0
        for start in range(0, len(order), batch_size):
            selected = order[start:start + batch_size]
            trainer.model.train()
            trainer.optimizer.zero_grad()
            result = renderer.render_rays(data['origins'][selected][None], data['directions'][selected][None],
                                          differentiable=True)
            if not torch.isfinite(result['rgb']).all():
                raise ValueError('native rendered observations must be finite')
            loss = torch.nn.functional.mse_loss(result['rgb'][0], data['rgb'][selected])
            if not torch.isfinite(loss):
                raise ValueError('native ray RGB objective must be finite')
            loss.backward()
            if any(p.grad is not None and not torch.isfinite(p.grad).all() for p in trainer.model.parameters()):
                raise ValueError('native ray derivatives must be finite')
            trainer.optimizer.step()
            total += loss.item() * len(selected)
        losses.append(total / len(order))
    return {'losses': losses, 'final_loss': losses[-1], 'objective': 'rendered_ray_rgb',
            'density_gradient_path': True, 'num_rays': len(data['origins'])}
