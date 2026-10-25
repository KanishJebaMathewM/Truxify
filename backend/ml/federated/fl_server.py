from fractions import Fraction
from numbers import Integral
from threading import RLock

import numpy as np

MAX_WEIGHTS = 4096
MAX_CLIENTS = 256
MAX_SCALAR_UPDATES = 1048576
MAX_COUNT_BITS = 4096


class FederatedAveragingServer:
    """Bounded standalone sample-weighted binary64 aggregation.

    This class does not decrypt transport or coordinate distributed rounds.
    Integer accumulation trades vectorized throughput for reliable wide-range
    convex means. The separate robust median helper is independent.
    """

    def __init__(self, num_weights: int = 10):
        if (
            isinstance(num_weights, (bool, np.bool_))
            or not isinstance(num_weights, Integral)
            or not 1 <= num_weights <= MAX_WEIGHTS
        ):
            raise ValueError(f"num_weights must be an integer in [1, {MAX_WEIGHTS}]")
        self._num_weights = int(num_weights)
        self._lock = RLock()
        self._global_weights = np.zeros(self._num_weights, dtype=np.float64)

    @property
    def num_weights(self):
        """The fixed model width cannot change during an admitted batch."""
        return self._num_weights

    def _vector(self, value):
        raw = np.asarray(value)
        if raw.shape != (self.num_weights,) or raw.dtype.kind not in "iuf":
            raise ValueError("weights must be an exact-width real numeric vector")
        with np.errstate(over="ignore", invalid="ignore"):
            owned = np.array(raw, dtype=np.float64, copy=True)
        if not np.isfinite(owned).all():
            raise ValueError("weights must be finite representable binary64 values")
        return owned

    @property
    def global_weights(self):
        """Return an independent model snapshot, never a writable state alias."""
        with self._lock:
            return self._global_weights.copy()

    @global_weights.setter
    def global_weights(self, value):
        """Retain the legacy setter with complete owned model admission."""
        candidate = self._vector(value)
        with self._lock:
            self._global_weights = candidate

    def aggregate_updates(self, client_updates: list) -> np.ndarray:
        """Validate the entire batch, calculate a convex mean, then publish once."""
        if not isinstance(client_updates, (list, tuple)):
            raise TypeError("client_updates must be a bounded sequence")
        if (
            len(client_updates) > MAX_CLIENTS
            or len(client_updates) * self.num_weights > MAX_SCALAR_UPDATES
        ):
            raise ValueError("client batch exceeds aggregation budget")
        if not client_updates:
            return self.global_weights
        admitted = []
        for client in client_updates:
            if (
                not isinstance(client, dict)
                or "weights" not in client
                or "num_samples" not in client
            ):
                raise ValueError("each client requires weights and num_samples")
            count = client["num_samples"]
            if isinstance(count, (bool, np.bool_)) or not isinstance(count, Integral):
                raise TypeError("num_samples must be a positive integer")
            count = int(count)
            if count <= 0 or count.bit_length() > MAX_COUNT_BITS:
                raise ValueError(
                    "num_samples must be positive and within the bit budget"
                )
            admitted.append((self._vector(client["weights"]), count))
        total_samples = sum(count for _, count in admitted)
        divisor = total_samples << 1074
        candidate = np.empty(self.num_weights, dtype=np.float64)
        for coordinate in range(self.num_weights):
            numerator = 0
            for weights, count in admitted:
                value, denominator = float(weights[coordinate]).as_integer_ratio()
                # Every finite binary64 value is an integer multiple of 2^-1074.
                # Accumulate exactly before dividing once; neither normalized
                # sample shares nor cancellation can underflow/overflow early.
                units = value << (1074 - (denominator.bit_length() - 1))
                numerator += units * count
            candidate[coordinate] = float(Fraction(numerator, divisor))
        if not np.isfinite(candidate).all():
            raise ValueError("aggregate is not finitely representable")
        with self._lock:
            self._global_weights = candidate
            return candidate.copy()

fl_server = FederatedAveragingServer()


def robust_aggregate(layer_weights, global_weights=None, clip_norm=1.0):
    """Coordinate-wise median aggregator (byzantine-robust).

    Unlike a naive ``np.mean``, the median is resistant to a single malicious
    or compromised client submitting extreme weights: one outlier cannot move
    the median materially. When ``global_weights`` is provided, the per-layer
    delta from the previous global weights is clipped to ``clip_norm`` so even
    several colluding clients cannot shift the global model arbitrarily.

    Parameters
    ----------
    layer_weights : iterable of array-like
        Per-client weight arrays for a single layer (same shape each).
    global_weights : array-like, optional
        Previous global weights for this layer, used to clip the update delta.
    clip_norm : float
        Maximum L2 norm of the aggregated delta.
    """
    if (isinstance(clip_norm, (bool, np.bool_)) or not np.isscalar(clip_norm)
            or np.asarray(clip_norm).dtype.kind not in 'fiu'):
        raise ValueError("clip_norm must be a finite nonnegative numeric scalar")
    try:
        radius = float(clip_norm)
    except (ValueError, TypeError, OverflowError) as exc:
        raise ValueError("clip_norm must be a finite nonnegative numeric scalar") from exc
    if not np.isfinite(radius) or radius < 0:
        raise ValueError("clip_norm must be finite and nonnegative")

    def numeric_layer(value):
        array = np.asarray(value)
        if array.dtype.kind not in 'fiu' or not array.size:
            raise ValueError("layers must be nonempty real numeric arrays")
        with np.errstate(over='ignore', invalid='ignore'):
            array = array.astype(np.float64)
        if not np.isfinite(array).all():
            raise ValueError("layers must contain finite representable values")
        return array

    layers = [numeric_layer(w) for w in layer_weights]
    if not layers or any(w.shape != layers[0].shape for w in layers):
        raise ValueError("client layers must have identical nonempty shapes")
    baseline = None if global_weights is None else numeric_layer(global_weights)
    if baseline is not None and baseline.shape != layers[0].shape:
        raise ValueError("global layer must exactly match client layer shape")

    ordered = np.sort(np.stack(layers, axis=0), axis=0)
    middle = len(layers) // 2
    if len(layers) % 2:
        median = ordered[middle].copy()
    else:
        lower, upper = ordered[middle - 1], ordered[middle]
        same_sign = np.signbit(lower) == np.signbit(upper)
        large = same_sign & ((np.abs(lower) > np.finfo(float).max / 2)
                             | (np.abs(upper) > np.finfo(float).max / 2))
        median = np.empty_like(lower)
        # Safe sums retain subnormal rounding; bounded same-sign differences
        # avoid overflow only where the ordinary midpoint sum is unsafe.
        median[~large] = (lower[~large] + upper[~large]) / 2
        median[large] = lower[large] + (upper[large] - lower[large]) / 2

    if baseline is not None and radius > 0:
        with np.errstate(over='ignore', invalid='ignore'):
            delta = median - baseline
        if np.isfinite(delta).all():
            # Scale the difference itself: a large unchanged coordinate must
            # not erase a much smaller update in a different coordinate.
            scale = float(np.max(np.abs(delta)))
            direction = delta / scale if scale > 0 else delta
        else:
            scale = max(float(np.max(np.abs(median))), float(np.max(np.abs(baseline))))
            # Only overflowing subtraction needs endpoint scaling; some
            # direction coordinate is then larger than1, so the norm is safe.
            direction = median / scale - baseline / scale
        if scale > 0:
            length = float(np.linalg.norm(direction))
            if length > 0 and scale > radius / length:
                median = baseline + direction * (radius / length)
    if not np.isfinite(median).all():
        raise ValueError("aggregate must be representable finitely")
    return median
