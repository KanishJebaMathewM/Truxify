"""Bounded exact binary64 linear policies; no invalid-score uniform fallback."""

import math
from fractions import Fraction

import numpy as np

MAX_AXIS = 256
MAX_WORK = 16384
PRODUCT_DENOMINATOR = 1 << 2148


def dimensions(state_dim, num_agents):
    if (
        any(
            type(value) is not int or not 1 <= value <= MAX_AXIS
            for value in (state_dim, num_agents)
        )
        or state_dim * num_agents > MAX_WORK
    ):
        raise ValueError(
            "policy dimensions require positive integers <=256 and work<=16384"
        )


def owned(values, shape):
    raw = np.asarray(values)
    if raw.shape != shape or raw.dtype.kind not in "iuf":
        raise ValueError("policy input requires complete real numeric shapes")
    with np.errstate(over="ignore", invalid="ignore"):
        result = np.array(raw, dtype=np.float64, copy=True)
    if not np.isfinite(result).all():
        raise ValueError("policy inputs must be representable finite binary64 values")
    return result


def units(value):
    numerator, denominator = float(value).as_integer_ratio()
    return numerator << (1074 - (denominator.bit_length() - 1))


def scores(state, weights):
    state_units = [units(value) for value in state]
    return [
        sum(value * units(weight) for value, weight in zip(state_units, column))
        for column in weights.T
    ]


def evaluate_policy(state, actor, critic):
    """Accumulate exactly, then exponentiate only bounded nonpositive differences."""
    critic_score = scores(state, critic)[0]
    try:
        value = float(Fraction(critic_score, PRODUCT_DENOMINATOR))
    except OverflowError as exc:
        raise ValueError("critic result is outside finite binary64 range") from exc
    if not math.isfinite(value):
        raise ValueError("critic result must be finite")
    logits = scores(state, actor)
    maximum = max(logits)
    # exp(-746) is below binary64's smallest subnormal; larger differences
    # contribute zero. No unrepresentable absolute logit is converted to float.
    exponentials = [
        0.0
        if maximum - logit > 746 * PRODUCT_DENOMINATOR
        else math.exp(-float(Fraction(maximum - logit, PRODUCT_DENOMINATOR)))
        for logit in logits
    ]
    total = math.fsum(exponentials)
    probabilities = [value / total for value in exponentials]
    return value, probabilities, logits.index(maximum)
