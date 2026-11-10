"""Conservative exact-binary geometry admission for the extreme-point heuristic."""

import math
from fractions import Fraction
from itertools import pairwise


def finite(value, name, *, zero=False):
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a finite number")  # noqa: TRY004 -- uniform observation errors
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"{name} must be a finite number") from exc
    if not math.isfinite(result) or (result < 0 if zero else result <= 0):
        raise ValueError(f"{name} must be finite and {'nonnegative' if zero else 'positive'}")
    return result


def observations(items):
    admitted = []
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise ValueError(f"items[{index}] must be a mapping")  # noqa: TRY004 -- uniform observation errors
        value = dict(item)
        value.setdefault("id", f"item_{index}")
        for field in ("length", "width", "height"):
            value[field] = finite(item.get(field, 1), f"items[{index}].{field}")
        value["weight_kg"] = finite(item.get("weight_kg", 0), f"items[{index}].weight_kg", zero=True)
        for field, default in (("stackable", True), ("fragile", False), ("allow_rotation", True)):
            value[field] = item.get(field, default)
            if type(value[field]) is not bool:
                raise ValueError(f"items[{index}].{field} must be a boolean")
        admitted.append(value)
    return admitted


def bounds(position, dimensions):
    low = tuple(Fraction(v) for v in position)
    high = tuple(a + Fraction(b) for a, b in zip(low, dimensions))
    return low, high


def entry_bounds(item):
    return bounds(tuple(item["position"][k] for k in ("x", "y", "z")),
                  tuple(item["dimensions"][k] for k in ("l", "w", "h")))


def supported(position, dimensions, packed, container):
    """Prove containment, disjoint boxes and complete coplanar footprint union.

    Rational comparisons describe the emitted binary floats exactly. Rounded
    candidate contacts that cannot be proved are rejected conservatively.
    """
    low, high = bounds(position, dimensions)
    if any(a < 0 or b > Fraction(c) for a, b, c in zip(low, high, container)):
        return False
    rectangles = []
    for item in packed:
        before, after = entry_bounds(item)
        if all(low[i] < after[i] and high[i] > before[i] for i in range(3)):
            return False
        footprint = (max(low[0], before[0]), min(high[0], after[0]),
                     max(low[1], before[1]), min(high[1], after[1]))
        intersects = footprint[0] < footprint[1] and footprint[2] < footprint[3]
        eligible = item["stackable"] and not item["fragile"]
        # Preserve the existing prohibition on any overlapping column above
        # fragile/non-stackable cargo, including indirect stacking.
        if intersects and low[2] >= after[2] and not eligible:
            return False
        if intersects and low[2] == after[2] and eligible:
            rectangles.append(footprint)
    if low[2] == 0:
        return True
    cuts = sorted({low[0], high[0], *(x for r in rectangles for x in r[:2])})
    for left, right in pairwise(cuts):
        intervals = sorted((bottom, top) for x0, x1, bottom, top in rectangles
                           if x0 <= left and x1 >= right)
        covered = low[1]
        for bottom, top in intervals:
            if bottom > covered:
                return False
            covered = max(covered, top)
        if covered < high[1]:
            return False
    return bool(rectangles)


def order(item):
    # Exact products preserve legacy weight*volume order without overflow.
    return math.prod(Fraction(item[k]) for k in ("weight_kg", "length", "width", "height"))
