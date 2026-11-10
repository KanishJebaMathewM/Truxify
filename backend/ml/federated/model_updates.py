"""Owned native model admission and private candidate preparation."""

import math
from functools import wraps

import numpy as np

from .fl_server import robust_aggregate

MAX_ENVELOPE_BYTES = 4 * 1024 * 1024


def round_synchronized(method):
    """Serialize process-local round transitions, including nested aggregation."""

    @wraps(method)
    def synchronized(self, *args, **kwargs):
        with self._round_lock:
            return method(self, *args, **kwargs)

    return synchronized


def admit_model_weights(weights, reference):
    """Copy a complete exact-schema model in the native layer dtypes."""
    if (
        not isinstance(weights, (list, tuple))
        or len(weights) != len(reference)
        or not reference
    ):
        raise ValueError("Model update must contain every native layer array")
    admitted = []
    for value, native in zip(weights, reference):
        native = np.asarray(native)
        raw = np.asarray(value)
        if (
            raw.shape != native.shape
            or raw.dtype.kind not in "iuf"
            or native.dtype.kind != "f"
        ):
            raise ValueError("Model update must match native real layer shapes")
        if not np.isfinite(native).all():
            raise ValueError("Native model reference must be finite")
        with np.errstate(over="ignore", invalid="ignore"):
            owned = np.array(raw, dtype=native.dtype, copy=True)
        if not np.isfinite(owned).all():
            raise ValueError("Model update must be finite in native layer dtypes")
        admitted.append(owned)
    return admitted


def _parameter(value):
    if isinstance(value, (bool, np.bool_)) or not isinstance(
        value, (int, float, np.number)
    ):
        raise TypeError(
            "Round clipping/noise settings must be finite nonnegative numbers"
        )
    numeric = float(value)
    if not math.isfinite(numeric) or numeric < 0:
        raise ValueError(
            "Round clipping/noise settings must be finite nonnegative numbers"
        )
    return numeric


def prepare_round_candidate(
    client_weights, baseline, reference, clip_norm, noise_scale
):
    """Compute privately; no caller model, baseline or client buffer is mutated."""
    radius, noise = _parameter(clip_norm), _parameter(noise_scale)
    base = admit_model_weights(baseline, reference)
    if not client_weights:
        raise ValueError("No admitted client models")
    prepared = []
    for weights in client_weights.values():
        owned = admit_model_weights(weights, reference)
        with np.errstate(over="ignore", invalid="ignore"):
            gradients = [
                w.astype(np.float64) - b.astype(np.float64) for w, b in zip(owned, base)
            ]
            norm = math.hypot(*(float(np.linalg.norm(g)) for g in gradients))
        if not math.isfinite(norm) or any(not np.isfinite(g).all() for g in gradients):
            raise ValueError("Model deltas are not finitely representable")
        factor = min(1.0, radius / (norm + 1e-8))
        with np.errstate(over="ignore", invalid="ignore"):
            proposal = [
                b.astype(np.float64) + g * factor + np.random.normal(0, noise, g.shape)
                for b, g in zip(base, gradients)
            ]
        if any(not np.isfinite(w).all() for w in proposal):
            raise ValueError("Noisy model candidate must be finite")
        prepared.append(proposal)
    candidate = [
        robust_aggregate([w[layer] for w in prepared], base[layer], clip_norm=radius)
        for layer in range(len(base))
    ]
    return admit_model_weights(candidate, reference)
