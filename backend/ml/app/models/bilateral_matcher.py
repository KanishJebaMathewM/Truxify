"""Bilateral Matcher – pairs loads with trucks using the Hungarian Algorithm.

This module provides a pure-algorithmic (no ML training) matcher that builds
a cost matrix from spatial distance, capacity compatibility, deadline urgency,
and driver rating, then solves the optimal assignment via
``scipy.optimize.linear_sum_assignment``.
"""

import logging
import math
import os
from typing import List, Dict, Any

import numpy as np
import requests
from scipy.optimize import linear_sum_assignment

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_EARTH_RADIUS_KM = 6_371.0
_DEFAULT_OSRM_BASE_URL = "https://router.project-osrm.org"
_OSRM_TIMEOUT_SECONDS = 1.5
_FALLBACK_AVG_SPEED_KMH = 50.0


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return the great-circle distance in **km** between two points."""
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * _EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def _osrm_enabled() -> bool:
    return os.getenv("TRUXIFY_ML_USE_OSRM", "true").strip().lower() not in {"0", "false", "no", "off"}


def _fetch_route_duration_matrix(
    drivers: List[Dict[str, Any]],
    loads: List[Dict[str, Any]],
) -> list[list[float | None]] | None:
    """Fetch road travel durations from every driver to every load origin."""
    if not _osrm_enabled() or not drivers or not loads:
        return None

    coordinates = [
        f"{driver['current_lng']},{driver['current_lat']}"
        for driver in drivers
    ] + [
        f"{load['origin_lng']},{load['origin_lat']}"
        for load in loads
    ]
    source_indexes = ";".join(str(i) for i in range(len(drivers)))
    destination_offset = len(drivers)
    destination_indexes = ";".join(
        str(destination_offset + i) for i in range(len(loads))
    )
    base_url = os.getenv("OSRM_BASE_URL", _DEFAULT_OSRM_BASE_URL).rstrip("/")
    url = f"{base_url}/table/v1/driving/{';'.join(coordinates)}"

    try:
        response = requests.get(
            url,
            params={
                "sources": source_indexes,
                "destinations": destination_indexes,
                "annotations": "duration",
            },
            timeout=_OSRM_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        payload = response.json()
        durations = payload.get("durations") if isinstance(payload, dict) else None
        if not isinstance(durations, list) or len(durations) != len(drivers):
            logger.warning("OSRM returned an invalid bilateral duration matrix")
            return None
        if any(not isinstance(row, list) or len(row) != len(loads) for row in durations):
            logger.warning("OSRM returned an invalid bilateral duration row")
            return None
        return durations
    except (requests.RequestException, ValueError, TypeError) as exc:
        logger.warning("OSRM bilateral duration lookup failed: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Cost-matrix components
# ---------------------------------------------------------------------------

_MAX_DISTANCE_KM = 3_000.0  # normalisation ceiling
_PENALTY_INFEASIBLE = 1e6   # effectively forbids the pairing
# Cost above this is treated as infeasible. Must sit well below the 1e6 penalty
# so that a negative `_rating_bonus` (−10 for a 5-star driver) cannot pull an
# infeasible pairing's cost back under the threshold and get it accepted.
_INFEASIBLE_THRESHOLD = 1e5
# Assignments at or above this cost are better represented by leaving the
# load/driver unmatched. This matches the zero-score boundary below.
_UNMATCHED_COST = 200.0


def _validate_finite_value(
    value: Any,
    field_name: str,
    *,
    minimum: float | None = None,
    maximum: float | None = None,
    positive: bool = False,
) -> float:
    """Validate that a matching input is finite and within its allowed range."""
    try:
        numeric_value = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be a finite number") from exc

    if not math.isfinite(numeric_value):
        raise ValueError(f"{field_name} must be a finite number")
    if positive and numeric_value <= 0:
        raise ValueError(f"{field_name} must be greater than 0")
    if minimum is not None and numeric_value < minimum:
        raise ValueError(f"{field_name} must be at least {minimum}")
    if maximum is not None and numeric_value > maximum:
        raise ValueError(f"{field_name} must be at most {maximum}")

    return numeric_value


def _validate_bilateral_inputs(
    loads: List[Dict[str, Any]],
    drivers: List[Dict[str, Any]],
) -> None:
    """Validate direct matcher inputs before building the optimization matrix."""
    load_ranges = {
        "origin_lat": (-90.0, 90.0),
        "origin_lng": (-180.0, 180.0),
        "dest_lat": (-90.0, 90.0),
        "dest_lng": (-180.0, 180.0),
    }
    load_positive_fields = (
        "weight_kg",
        "length_m",
        "width_m",
        "height_m",
        "deadline_hours",
    )
    driver_ranges = {
        "current_lat": (-90.0, 90.0),
        "current_lng": (-180.0, 180.0),
    }
    driver_positive_fields = (
        "max_weight_kg",
        "max_length_m",
        "max_width_m",
        "max_height_m",
    )

    for load_index, load in enumerate(loads):
        for field_name, (minimum, maximum) in load_ranges.items():
            _validate_finite_value(
                load.get(field_name),
                f"loads[{load_index}].{field_name}",
                minimum=minimum,
                maximum=maximum,
            )
        for field_name in load_positive_fields:
            _validate_finite_value(
                load.get(field_name),
                f"loads[{load_index}].{field_name}",
                positive=True,
            )

    for driver_index, driver in enumerate(drivers):
        for field_name, (minimum, maximum) in driver_ranges.items():
            _validate_finite_value(
                driver.get(field_name),
                f"drivers[{driver_index}].{field_name}",
                minimum=minimum,
                maximum=maximum,
            )
        for field_name in driver_positive_fields:
            _validate_finite_value(
                driver.get(field_name),
                f"drivers[{driver_index}].{field_name}",
                positive=True,
            )

        _validate_finite_value(
            driver.get("rating", 3.0),
            f"drivers[{driver_index}].rating",
            minimum=1.0,
            maximum=5.0,
        )

        for field_name, (minimum, maximum) in {
            "preferred_dest_lat": (-90.0, 90.0),
            "preferred_dest_lng": (-180.0, 180.0),
        }.items():
            value = driver.get(field_name)
            if value is not None:
                _validate_finite_value(
                    value,
                    f"drivers[{driver_index}].{field_name}",
                    minimum=minimum,
                    maximum=maximum,
                )


def _distance_cost(driver: dict, load: dict) -> float:
    """Haversine distance from driver's current location to load origin."""
    return _haversine(
        driver["current_lat"],
        driver["current_lng"],
        load["origin_lat"],
        load["origin_lng"],
    )


def _weight_penalty(driver: dict, load: dict) -> float:
    """Return 0 if the driver can carry the load weight, else INFEASIBLE."""
    if load["weight_kg"] > driver["max_weight_kg"]:
        return _PENALTY_INFEASIBLE
    return 0.0


def _dimension_penalty(driver: dict, load: dict) -> float:
    """Return 0 if load dimensions fit the truck, else INFEASIBLE."""
    if (
        load["length_m"] > driver["max_length_m"]
        or load["width_m"] > driver["max_width_m"]
        or load["height_m"] > driver["max_height_m"]
    ):
        return _PENALTY_INFEASIBLE
    return 0.0


def _deadline_urgency(
    load: dict,
    distance_km: float,
    route_duration_seconds: float | None = None,
) -> float:
    """Penalise matches where estimated travel time is tight versus deadline.

    Road-network duration is preferred when available. The previous straight-line
    distance estimate is retained only as an explicit routing-service fallback.
    """
    if route_duration_seconds is not None:
        if not math.isfinite(route_duration_seconds) or route_duration_seconds < 0:
            return _PENALTY_INFEASIBLE
        travel_hours = route_duration_seconds / 3600.0
    else:
        travel_hours = distance_km / _FALLBACK_AVG_SPEED_KMH

    deadline = load.get("deadline_hours", 72.0)
    if deadline <= 0:
        return _PENALTY_INFEASIBLE
    ratio = travel_hours / deadline  # >1 means impossible
    if ratio > 1.0:
        return _PENALTY_INFEASIBLE
    return ratio * 100.0  # scale for cost matrix


def _destination_penalty(driver: dict, load: dict) -> float:
    """Penalize drivers whose preferred destination is far from load dest."""
    pref_lat = driver.get("preferred_dest_lat")
    pref_lng = driver.get("preferred_dest_lng")
    if pref_lat is None or pref_lng is None:
        return 0.0
    dist = _haversine(pref_lat, pref_lng, load["dest_lat"], load["dest_lng"])
    return dist * 0.3  # lower weight


def _rating_bonus(driver: dict) -> float:
    """Higher-rated drivers get a slight cost *reduction* (negative cost)."""
    rating = driver.get("rating", 3.0)
    return -(rating - 3.0) * 5.0  # 5-star → −10; 1-star → +10


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def match_bilateral(
    loads: List[Dict[str, Any]],
    drivers: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Optimally pair loads with drivers using the Hungarian algorithm.

    Parameters
    ----------
    loads : list[dict]
        Each dict must contain ``origin_lat``, ``origin_lng``, ``dest_lat``,
        ``dest_lng``, ``weight_kg``, ``length_m``, ``width_m``, ``height_m``,
        ``deadline_hours``.
    drivers : list[dict]
        Each dict must contain ``current_lat``, ``current_lng``,
        ``max_weight_kg``, ``max_length_m``, ``max_width_m``,
        ``max_height_m``, ``preferred_dest_lat``, ``preferred_dest_lng``,
        ``rating``.

    Returns
    -------
    dict
        ``assignments`` – list of ``{load_index, driver_index, match_score}``
        ``unmatched_loads``  – indices of loads without a match
        ``unmatched_drivers`` – indices of drivers without a match
    """
    _validate_bilateral_inputs(loads, drivers)

    n_loads = len(loads)
    n_drivers = len(drivers)

    # Edge cases
    if n_loads == 0 and n_drivers == 0:
        return {"assignments": [], "unmatched_loads": [], "unmatched_drivers": []}
    if n_loads == 0:
        return {
            "assignments": [],
            "unmatched_loads": [],
            "unmatched_drivers": list(range(n_drivers)),
        }
    if n_drivers == 0:
        return {
            "assignments": [],
            "unmatched_loads": list(range(n_loads)),
            "unmatched_drivers": [],
        }

    route_durations = _fetch_route_duration_matrix(drivers, loads)

    # Build cost matrix  (rows = loads, cols = drivers)
    cost = np.zeros((n_loads, n_drivers), dtype=np.float64)

    for i, load in enumerate(loads):
        for j, driver in enumerate(drivers):
            dist_km = _distance_cost(driver, load)
            route_duration_seconds = None
            if route_durations is not None:
                candidate_duration = route_durations[j][i]
                if candidate_duration is None:
                    route_duration_seconds = float("inf")
                elif isinstance(candidate_duration, (int, float)) and math.isfinite(candidate_duration):
                    route_duration_seconds = float(candidate_duration)
                else:
                    route_duration_seconds = float("inf")
            c = (
                dist_km / _MAX_DISTANCE_KM * 100.0  # normalised distance
                + _weight_penalty(driver, load)
                + _dimension_penalty(driver, load)
                + _deadline_urgency(load, dist_km, route_duration_seconds)
                + _destination_penalty(driver, load)
                + _rating_bonus(driver)
            )
            cost[i, j] = c

    # Add explicit dummy rows/columns so the optimizer can choose an unmatched
    # load or driver instead of being forced to accept a poor finite pairing.
    size = n_loads + n_drivers
    assignment_cost = np.zeros((size, size), dtype=np.float64)
    assignment_cost[:n_loads, :n_drivers] = cost
    assignment_cost[:n_loads, n_drivers:] = _UNMATCHED_COST
    assignment_cost[n_loads:, :n_drivers] = _UNMATCHED_COST

    # Solve the augmented assignment problem.
    row_idx, col_idx = linear_sum_assignment(assignment_cost)

    assignments = []
    matched_loads = set()
    matched_drivers = set()

    for r, c in zip(row_idx, col_idx):
        # Dummy row/column assignments represent unmatched entities.
        if r >= n_loads or c >= n_drivers:
            continue
        if cost[r, c] >= _INFEASIBLE_THRESHOLD:
            continue  # infeasible pairing – skip
        if cost[r, c] >= _UNMATCHED_COST:
            continue  # a poor finite pairing is worse than staying unmatched
        score = round(min(1.0, max(0.0, 1.0 - cost[r, c] / 200.0)), 4)  # 0‥1
        assignments.append(
            {"load_index": int(r), "driver_index": int(c), "match_score": float(score)}
        )
        matched_loads.add(int(r))
        matched_drivers.add(int(c))

    unmatched_loads = sorted(set(range(n_loads)) - matched_loads)
    unmatched_drivers = sorted(set(range(n_drivers)) - matched_drivers)

    logger.info(
        "Bilateral matching complete: %d assignments, %d unmatched loads, %d unmatched drivers",
        len(assignments),
        len(unmatched_loads),
        len(unmatched_drivers),
    )

    return {
        "assignments": assignments,
        "unmatched_loads": unmatched_loads,
        "unmatched_drivers": unmatched_drivers,
    }
