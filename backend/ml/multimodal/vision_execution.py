"""One shared native frame operation owner; callers use bounded execution."""
import json
import threading
from functools import wraps

import cv2
import numpy as np

_INIT_GUARD = threading.Lock()


def frame_owner(monitor):
    """Initialize a single reentrant owner, including legacy/direct instances."""
    owner = getattr(monitor, "_frame_operation_owner", None)
    if owner is None:
        with _INIT_GUARD:
            owner = getattr(monitor, "_frame_operation_owner", None)
            if owner is None:
                owner = threading.RLock()
                monitor._frame_operation_owner = owner
    return owner


def valid_frame(frame):
    """Retain the existing bounded nonempty uint8 BGR input contract."""
    return (isinstance(frame, np.ndarray) and frame.dtype == np.uint8
            and frame.ndim == 3 and frame.shape[2] == 3
            and 1 <= frame.shape[0] <= 8192 and 1 <= frame.shape[1] <= 8192)


def owned_frame_operation(method):
    """Own frame storage and all graph/counter/report work until completion."""
    @wraps(method)
    def run(monitor, frame):
        with frame_owner(monitor):
            # Invalid input follows the original unknown/error/reset path.
            if valid_frame(frame):
                try:
                    frame = np.array(frame, copy=True, subok=False)
                except (MemoryError, TypeError, ValueError) as error:
                    return monitor._unknown_frame("ERROR", error)
            return method(monitor, frame)
    return run


def process_encoded_frame(monitor, contents):
    """Decode one admitted immutable upload within the whole monitor operation."""
    if not isinstance(contents, bytes):
        raise TypeError("Vision decoding requires admitted immutable bytes")
    with frame_owner(monitor):
        frame = cv2.imdecode(np.frombuffer(contents, np.uint8), cv2.IMREAD_COLOR)
        # imdecode allocated this frame locally; no caller holds its storage.
        # Retain the same owner without allocating a redundant BGR copy.
        return monitor._process_owned_frame(frame)


def read_latest_vision(monitor):
    """Read and parse native cache data outside the event loop/frame owner."""
    data = monitor.redis.get("vision:latest")
    return bool(data), json.loads(data) if data else None
