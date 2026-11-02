"""Finite binary64 A/B observations, displays and one eligible vote set."""

import math
from fractions import Fraction
from numbers import Real

LOWER_KEYWORDS = {'rmse', 'mae', 'mse', 'loss', 'error_rate', 'latency', 'error'}


def finite_number(value):
    if isinstance(value, bool) or not isinstance(value, Real):
        raise TypeError('metric values must be finite real binary64 numbers')
    try:
        number = float(value)
    except (OverflowError, ValueError) as exc:
        raise ValueError('metric values must fit finite binary64') from exc
    if not math.isfinite(number):
        raise ValueError('metric values must be finite')
    return number


def admit_threshold(value):
    value = finite_number(value)
    if value < 0:
        raise ValueError('threshold must be nonnegative')
    return value


def higher_is_better(name):
    return not any(word in name.lower() for word in LOWER_KEYWORDS)


def finite_mean(values):
    """Exact binary summation, one correctly rounded native mean; no partial group.

    Every finite binary64 denominator is a power of two. Fraction accumulation
    therefore keeps bounded-size binary integers (plus log(count) bits), avoiding
    both sum overflow and divide-first subnormal/cancellation loss.
    """
    total, count, invalid = Fraction(), 0, 0
    for value in values:
        count += 1
        try:
            total += Fraction.from_float(finite_number(value))
        except (TypeError, ValueError):
            invalid += 1
    if not count or invalid:
        return None, invalid
    return float(total / count), 0


def _change(production, shadow, higher):
    if type(higher) is not bool:
        raise TypeError('metric direction must be boolean')
    p = Fraction.from_float(finite_number(production))
    s = Fraction.from_float(finite_number(shadow))
    delta = s - p if higher else p - s
    # Preserve the public legacy zero-baseline convention (absolute delta*100).
    return (delta / abs(p) if p else delta) * 100


def improvement(production, shadow, higher=True):
    exact = _change(production, shadow, higher)
    try:
        return float(exact)
    except OverflowError:
        # The pair remains comparable; its finite display percentage does not.
        return None


def eligible_pairs(results):
    for name, values in results.items():
        if not isinstance(name, str) or not isinstance(values, dict):
            continue
        try:
            production = finite_number(values.get('production'))
            shadow = finite_number(values.get('shadow'))
        except (TypeError, ValueError):
            continue
        yield name, production, shadow


def shadow_better(results, threshold):
    t = Fraction.from_float(admit_threshold(threshold))
    votes = []
    for name, production, shadow in eligible_pairs(results):
        higher = higher_is_better(name)
        p, s = Fraction.from_float(production), Fraction.from_float(shadow)
        # Positive baselines retain the original one-rounded p*threshold gate.
        # Translate that same margin using abs(p) for signed baselines. Round
        # once before comparing so native boundary equality stays a strict tie.
        boundary = p - abs(p) * (1 - t)
        try:
            native_boundary = float(boundary)
        except OverflowError:
            votes.append(s > boundary if higher else s < boundary)
        else:
            votes.append(shadow > native_boundary if higher else shadow < native_boundary)
    return sum(votes) * 2 > len(votes) if votes else False


def summarize(metrics, production_version, shadow_version):
    groups = {}
    invalid_names = 0
    for row in metrics:
        if row.model_version == production_version:
            role = 'production'
        elif shadow_version is not None and row.model_version == shadow_version:
            role = 'shadow'
        else:
            continue
        name = row.metric_name
        if not isinstance(name, str) or not name.strip() or len(name) > 50:
            invalid_names += 1
            continue
        groups.setdefault(name, {'production': [], 'shadow': []})[role].append(row.metric_value)
    results = {}
    for name, roles in groups.items():
        p, bad_p = finite_mean(roles['production'])
        s, bad_s = finite_mean(roles['shadow'])
        invalid = bool(bad_p or bad_s)
        complete = p is not None and s is not None
        value = improvement(p, s, higher_is_better(name)) if complete else None
        result = {'production': p, 'shadow': s, 'improvement': value}
        if invalid or not complete or value is None:
            result.update({
                'improvement_status': ('invalid_observations' if invalid else
                                       'incomplete' if not complete else 'outside_float_range'),
                'invalid_observations': {'production': bad_p, 'shadow': bad_s},
            })
        if complete and p == 0:
            result['improvement_basis'] = 'absolute_delta_x100'
        results[name] = result
    return results, invalid_names
