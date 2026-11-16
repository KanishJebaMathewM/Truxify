"""Private ownership for one pipeline's native rolling ETA observations."""
import threading
from collections import deque

import numpy as np

_LOCK_INIT_GUARD = threading.Lock()


def observation_lock(pipeline):
    """Share the same reentrant owner with direct and realtime predictions."""
    lock = getattr(pipeline, "_eta_predict_lock", None)
    if lock is None:
        with _LOCK_INIT_GUARD:
            lock = getattr(pipeline, "_eta_predict_lock", None)
            if lock is None:
                lock = threading.RLock()
                pipeline._eta_predict_lock = lock
    return lock


def prepare_window(route_data, previous):
    """Own one complete finite row and a private padded inference sequence."""
    if np.iscomplexobj(route_data):
        raise ValueError("ETA observations must be real-valued")
    row = np.array(route_data, dtype=np.float64, copy=True)
    if row.shape == (1, 5):
        row = row[0].copy()
    if row.shape != (5,) or not np.isfinite(row).all():
        raise ValueError("ETA observation must contain one finite five-feature row")
    window = deque(maxlen=60)
    for retained in previous or ():
        owned = np.array(retained, dtype=np.float64, copy=True)
        if owned.shape != (5,) or not np.isfinite(owned).all():
            raise ValueError("Retained ETA observation is invalid")
        window.append(owned)
    window.append(row)
    sequence = list(window)
    sequence = [sequence[0]] * (60 - len(sequence)) + sequence
    model_input = np.array(sequence, dtype=np.float64, copy=True).reshape(1, 60, 5)
    return window, model_input


def finite_prediction(prediction):
    """Require exactly one finite scalar while retaining finite speed semantics."""
    result = np.asarray(prediction)
    if result.shape != (1, 1):
        raise ValueError("ETA model must return one scalar prediction")
    value = float(result[0, 0])
    if not np.isfinite(value):
        raise ValueError("ETA model returned a nonfinite prediction")
    return value
