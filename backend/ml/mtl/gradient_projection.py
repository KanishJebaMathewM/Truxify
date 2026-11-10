"""Owned, range-scaled sequential PCGrad over compatible real gradients."""

import torch

_DTYPES = {torch.float16, torch.bfloat16, torch.float32, torch.float64}
MAX_TASKS = 64
MAX_ELEMENTS = 8_000_000
MAX_PAIR_COORDINATES = 128_000_000


def project_conflicts(grads):
    """Project in normalized float64 coordinates, then restore source scales.

    The target vector's scale cancels from the orthogonal projection. Keeping
    each source normalized until every ordered projection is complete avoids
    both raw squared-norm overflow and premature output-dtype rounding.
    """
    if not isinstance(grads, (list, tuple)) or len(grads) > MAX_TASKS:
        raise ValueError("PCGrad requires a list or tuple of at most 64 gradients")
    if not grads:
        return []
    first = grads[0]
    if not isinstance(first, torch.Tensor):
        raise TypeError("PCGrad gradients must be tensors")
    count = first.numel()
    if (count * len(grads) > MAX_ELEMENTS
            or count * len(grads) * (len(grads) - 1) > MAX_PAIR_COORDINATES):
        raise ValueError("PCGrad gradient collection exceeds the work budget")
    # Admit the entire collection before allocating any projection candidates.
    for value in grads:
        if (not isinstance(value, torch.Tensor) or value.layout != torch.strided
                or value.dtype not in _DTYPES or value.device.type not in {"cpu", "cuda"}
                or value.shape != first.shape or value.dtype != first.dtype
                or value.device != first.device or not torch.isfinite(value).all()):
            raise ValueError("PCGrad requires finite compatible real CPU/CUDA tensors")

    with torch.no_grad():
        owned = [value.detach().to(dtype=torch.float64).clone().reshape(-1) for value in grads]
        if not count:
            return [value.detach().clone() for value in grads]
        scales = [value.abs().amax() for value in owned]
        normalized = [value / scale if scale > 0 else value
                      for value, scale in zip(owned, scales)]
        denominators = [torch.dot(value, value) for value in normalized]
        candidates = []
        for i, original in enumerate(normalized):
            current = original.clone()
            for j, target in enumerate(normalized):
                if i == j or denominators[j] == 0:
                    continue
                dot = torch.dot(current, target)
                if dot < 0:
                    current = current - (dot / denominators[j]) * target
            result = (current * scales[i]).reshape(first.shape).to(dtype=first.dtype)
            if not torch.isfinite(result).all():
                raise ValueError("PCGrad projected result is not representable in the input dtype")
            candidates.append(result)
        return candidates
