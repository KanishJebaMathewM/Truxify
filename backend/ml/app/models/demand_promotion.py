"""Finite observation admission and exact demand promotion comparison."""
import math
from fractions import Fraction
from numbers import Real


def admit_mae(value):
    if isinstance(value, bool) or not isinstance(value, Real):
        raise ValueError("Demand MAE and threshold must be finite nonnegative numbers")  # noqa: TRY004 - input protocol
    try:
        result = float(value)
    except OverflowError as exc:
        raise ValueError("Demand metric is not float-representable") from exc
    if not math.isfinite(result) or result < 0:
        raise ValueError("Demand MAE and threshold must be finite nonnegative numbers")
    return result


def meets_threshold(current, candidate, threshold):
    current, candidate, threshold = map(admit_mae, (current, candidate, threshold))
    if current == 0:
        # A zero threshold explicitly permits exact ties; positive thresholds do not.
        return candidate == 0 and threshold == 0
    current, candidate, threshold = map(Fraction.from_float, (current, candidate, threshold))
    return current - candidate >= threshold * current
