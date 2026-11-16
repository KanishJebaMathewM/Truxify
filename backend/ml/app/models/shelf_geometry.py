"""Finite private shelf observations and conservative emitted binary geometry."""

import math
from fractions import Fraction
from numbers import Real


def observation(value, field, *, positive=True):
    """Normalize once; booleans and unrepresentable values are not dimensions."""
    if isinstance(value, bool) or not isinstance(value, Real):
        raise ValueError(f"{field} must be a finite real number")  # noqa: TRY004 -- uniform numeric admission contract
    try:
        result = float(value)
    except (ValueError, OverflowError) as exc:
        raise ValueError(f"{field} exceeds numeric range") from exc
    if not math.isfinite(result) or (result <= 0 if positive else result < 0):
        raise ValueError(
            f"{field} must be finite and {'positive' if positive else 'nonnegative'}"
        )
    return result


def own_inputs(packages, truck):
    """Own complete observations before sorting or mutating any shelf."""
    dimensions = ("length", "width", "height")
    private_truck = {
        key: observation(truck.get(key), f"truck.{key}")
        for key in (*dimensions, "max_weight")
    }
    private_packages = [
        {
            key: observation(
                package.get(key), f"packages[{index}].{key}", positive=key != "weight"
            )
            for key in (*dimensions, "weight")
        }
        for index, package in enumerate(packages)
    ]
    return private_packages, private_truck


def exact(value):
    return Fraction(value)


def volume(package):
    return exact(package["length"]) * exact(package["width"]) * exact(package["height"])


def fits_sum(first, second, limit):
    return exact(first) + exact(second) <= exact(limit)


def upward_sum(first, second):
    """A public float cursor must not move inside the preceding exact box."""
    total = exact(first) + exact(second)
    rounded = float(total)
    return math.nextafter(rounded, math.inf) if exact(rounded) < total else rounded
