"""Owned split-conformal residual metadata for the synthetic profit baseline."""

import math
from itertools import pairwise
from numbers import Real

import numpy as np

METHOD = "split_conformal_absolute_residual"


def _number(value):
    if isinstance(value, (bool, np.bool_)) or not isinstance(value, Real):
        raise ValueError("interval values must be finite real numbers")  # noqa: TRY004 - input protocol
    try:
        result = float(value)
    except OverflowError as exc:
        raise ValueError("interval values must be finite real numbers") from exc
    if not math.isfinite(result):
        raise ValueError("interval values must be finite real numbers")
    return result


def validate(metadata):
    if metadata is None:
        return None
    if not isinstance(metadata, dict):
        raise ValueError("calibration must be a mapping")  # noqa: TRY004 - input protocol
    count, rank = metadata.get("sample_count"), metadata.get("rank")
    if (metadata.get("method") != METHOD or metadata.get("coverage") != 0.95
            or metadata.get("data_provenance") != "synthetic"
            or type(count) is not int or count < 19
            or type(rank) is not int or rank != (19 * (count + 1) + 19) // 20
            or rank > count):
        raise ValueError("invalid profit calibration provenance or rank")
    radius = _number(metadata.get("radius"))
    if radius < 0:
        raise ValueError("calibration radius must be nonnegative")
    return {"method": METHOD, "coverage": 0.95, "data_provenance": "synthetic",
            "sample_count": count, "rank": rank, "radius": radius}


def calibrate(targets, predictions):
    """95% marginal split-conformal rank; insufficient windows stay uncalibrated."""
    targets = np.asarray(targets, dtype=object)
    predictions = np.asarray(predictions, dtype=object)
    if targets.ndim != 1 or predictions.shape != targets.shape or targets.size == 0:
        raise ValueError("calibration requires matching nonempty scalar windows")
    owned_targets = np.array([_number(value) for value in targets], dtype=float)
    owned_predictions = np.array([_number(value) for value in predictions], dtype=float)
    with np.errstate(over="raise", invalid="raise"):
        try:
            residuals = np.abs(owned_targets - owned_predictions)
        except FloatingPointError as exc:
            raise ValueError("residual arithmetic exceeds finite range") from exc
    count = len(residuals)
    rank = (19 * (count + 1) + 19) // 20
    if rank > count:
        return None
    radius = float(np.partition(residuals, rank - 1)[rank - 1])
    return validate({"method": METHOD, "coverage": 0.95, "data_provenance": "synthetic",
                     "sample_count": count, "rank": rank, "radius": radius})


def interval(prediction, calibration, staged):
    prediction = _number(prediction)
    if calibration is not None:
        radius = calibration["radius"]
        provenance = dict(calibration)
    else:
        # Compatibility only: stage increments are not an empirical coverage estimate.
        values = [_number(np.asarray(value).item()) for value in staged]
        increments = [b - a for a, b in pairwise(values)]
        if any(not math.isfinite(value) for value in increments):
            raise ValueError("stage arithmetic exceeds finite range")
        scale = max((abs(value) for value in increments), default=0.0)
        spread = (scale * float(np.std(np.array(increments) / scale))) if scale else 0.0
        radius = 1.96 * max(spread, abs(prediction) * (0.05 if len(values) > 1 else 0.1))
        provenance = {"method": "legacy_stage_heuristic", "coverage": None,
                      "data_provenance": "uncalibrated"}
    lower, upper = prediction - radius, prediction + radius
    if not all(math.isfinite(value) for value in (lower, upper)):
        raise ValueError("interval endpoints exceed finite range")
    return {"predicted_profit": round(prediction, 2),
            "confidence_interval": {"lower": round(lower, 2), "upper": round(upper, 2)},
            "interval_calibration": provenance}
