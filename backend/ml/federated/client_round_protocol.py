"""Native client model/round admission and process-local round ownership."""

from functools import wraps

import numpy as np

MAX_MODEL_ENVELOPE_BYTES = 4 * 1024 * 1024


def round_owned(method):
    """Serialize receive/train/publish, including nested participation calls."""

    @wraps(method)
    def owned(self, *args, **kwargs):
        with self._round_lock:
            return method(self, *args, **kwargs)

    return owned


def admit_round_model(payload, reference, legacy_round):
    """Validate before any client model or round state is changed."""
    if isinstance(payload, dict):
        round_id = payload.get("round")
        weights = payload.get("weights")
    elif isinstance(payload, list):
        raw = legacy_round
        if isinstance(raw, bytes):
            raw = raw.decode("ascii")
        if (
            not isinstance(raw, str)
            or not raw.isascii()
            or not raw.isdigit()
            or len(raw) > 20
        ):
            raise ValueError("Legacy model requires a valid Redis round tag")
        round_id, weights = int(raw), payload
    else:
        raise TypeError("Model envelope must be an object or legacy list")
    if type(round_id) is not int or round_id < 0:
        raise ValueError("Server round tag must be a nonnegative integer")
    if not isinstance(weights, list) or not reference or len(weights) != len(reference):
        raise ValueError("Server model must contain the complete native layer schema")
    copied = []
    for value, native in zip(weights, reference):
        raw = np.asarray(value)
        if raw.shape != native.shape or raw.dtype.kind not in "iuf":
            raise ValueError("Server model layer must match native real shapes")
        with np.errstate(over="ignore", invalid="ignore"):
            layer = np.array(raw, dtype=native.dtype, copy=True)
        if not np.isfinite(layer).all():
            raise ValueError("Server model must be finite in native layer dtypes")
        copied.append(layer)
    return round_id, copied
