"""Bounded, owned native denoiser inputs; no inference or RNG in admission."""
from numbers import Integral

import torch
from torch import nn

MAX_PARAMETERS = 32_000_000
MAX_VALUES = 8_000_000
MAX_ATTENTION = 32_000_000
MAX_WORK = 256_000_000


def integer(value, name, low, high):
    if isinstance(value, bool) or not isinstance(value, Integral) or not low <= value <= high:
        raise ValueError(f"{name} must be an integer in [{low}, {high}]")
    return int(value)


def geometry(input_dim, hidden_dim, num_layers, num_heads, num_timesteps, cond_dim):
    d = integer(input_dim, "input_dim", 1, 4096)
    h = integer(hidden_dim, "hidden_dim", 2, 4096)
    layers = integer(num_layers, "num_layers", 0, 32)
    heads = integer(num_heads, "num_heads", 1, 64)
    integer(num_timesteps, "num_timesteps", 1, 10000)
    if layers and h % heads:
        raise ValueError("hidden_dim must be divisible by num_heads")
    base = (3 + 7 * layers) * h * h + 2 * d * h + (6 + 11 * layers) * h + d
    if cond_dim is not None:
        c = integer(cond_dim, "cond_dim", 1, 4096)
        if base + h * c + h > MAX_PARAMETERS:
            raise ValueError("condition projection exceeds parameter budget")
    if base > MAX_PARAMETERS:
        raise ValueError("denoiser exceeds parameter budget")
    return base


def admit(model, x, timesteps, condition):
    weight = model.input_proj.weight
    if weight.dtype not in (torch.float32, torch.float64) or weight.device.type not in ("cpu", "cuda"):
        raise ValueError("denoiser supports CPU/CUDA float32 or float64")
    if (not isinstance(x, torch.Tensor) or x.layout != torch.strided or x.ndim != 3
            or not x.shape[0] or not x.shape[1] or x.shape[2] < model.input_dim
            or x.dtype != weight.dtype or x.device != weight.device):
        raise ValueError("x must be dense nonempty model-dtype/device batch/sequence rows")
    b, n, _ = x.shape
    h = model.hidden_dim
    layers = len(model.blocks) // 2
    heads = model.blocks[1].num_heads if layers else 1
    linear_work = b * n * (h * h * (3 + 7 * layers) + 2 * model.input_dim * h)
    if (b > 64 or n > 4096 or x.numel() > MAX_VALUES or b * n * h > MAX_VALUES
            or layers * b * heads * n * n > MAX_ATTENTION
            or linear_work > MAX_WORK):
        raise ValueError("denoiser input exceeds activation/attention/work budget")
    if (not isinstance(timesteps, torch.Tensor) or timesteps.layout != torch.strided
            or timesteps.dtype not in (torch.int32, torch.int64)
            or timesteps.shape != (b,) or timesteps.device != weight.device):
        raise ValueError("timesteps must be an integer vector with one index per batch row")
    if bool(((timesteps < 0) | (timesteps >= model.num_timesteps)).any()):
        raise ValueError("timestep index is outside the trained schedule")
    # Clone without detach so valid native feature/condition gradients survive.
    x = x.clone()
    timesteps = timesteps.to(dtype=torch.int64).clone()
    if not bool(torch.isfinite(x).all()):
        raise ValueError("x must contain finite observations")
    if x.shape[2] > model.input_dim:
        if condition is not None:
            raise ValueError("conditions cannot be supplied twice")
        condition = x[..., model.input_dim:]
        x = x[..., :model.input_dim]
    if condition is not None:
        try:
            condition = torch.as_tensor(condition, device=weight.device)
        except (TypeError, ValueError, RuntimeError) as exc:
            raise ValueError("condition must contain real numeric observations") from exc
        if condition.layout != torch.strided or condition.is_complex() or condition.dtype == torch.bool:
            raise ValueError("condition must contain finite real numeric values")
        if condition.ndim == 1:
            condition = condition.unsqueeze(0)
        if (condition.ndim not in (2, 3) or not 1 <= condition.shape[-1] <= 4096
                or condition.shape[0] not in (1, b)
                or (condition.ndim == 3 and condition.shape[1] not in (1, n))
                or condition.numel() > MAX_VALUES):
            raise ValueError("condition batch/sequence schema must match input")
        c = condition.shape[-1]
        if model._base_parameters + h * c + h > MAX_PARAMETERS or linear_work + b * n * h * c > MAX_WORK:
            raise ValueError("condition exceeds projection/work budget")
        projection = model.cond_proj.weight
        if not isinstance(projection, nn.parameter.UninitializedParameter) and projection.shape[1] != c:
            raise ValueError("condition width differs from the registered projection")
        condition = condition.to(dtype=weight.dtype).clone()
        if not bool(torch.isfinite(condition).all()):
            raise ValueError("condition must be finite in model dtype")
    return x, timesteps, condition
