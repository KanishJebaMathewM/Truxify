"""Bilateral Matcher – pairs loads with trucks using the Hungarian Algorithm.

This module provides a pure-algorithmic (no ML training) matcher that builds
a cost matrix from spatial distance, capacity compatibility, deadline urgency,
and driver rating, then solves the optimal assignment via
``scipy.optimize.linear_sum_assignment``.
"""

import logging
import math
from typing import List, Dict, Any

import numpy as np
from scipy.optimize import linear_sum_assignment

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_EARTH_RADIUS_KM = 6_371.0


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return the great-circle distance in **km** between two points."""
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * _EARTH_RADIUS_KM * math.asin(math.sqrt(a))


# ---------------------------------------------------------------------------
# Cost-matrix components
# ---------------------------------------------------------------------------

_MAX_DISTANCE_KM = 3_000.0  # normalisation ceiling
_PENALTY_INFEASIBLE = 1e6   # effectively forbids the pairing
# Cost above this is treated as infeasible. Must sit well below the 1e6 penalty
# so that a negative `_rating_bonus` (−10 for a 5-star driver) cannot pull an
# infeasible pairing's cost back under the threshold and get it accepted.
_INFEASIBLE_THRESHOLD = 1e5


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


def _deadline_urgency(load: dict, distance_km: float) -> float:
    """Penalise matches where estimated travel time is tight versus deadline.

    Higher cost when the deadline is close relative to distance.
    """
    avg_speed_kmh = 50.0
    travel_hours = distance_km / avg_speed_kmh if avg_speed_kmh > 0 else 0.0
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

    # Build cost matrix  (rows = loads, cols = drivers)
    cost = np.zeros((n_loads, n_drivers), dtype=np.float64)

    for i, load in enumerate(loads):
        for j, driver in enumerate(drivers):
            dist_km = _distance_cost(driver, load)
            c = (
                dist_km / _MAX_DISTANCE_KM * 100.0  # normalised distance
                + _weight_penalty(driver, load)
                + _dimension_penalty(driver, load)
                + _deadline_urgency(load, dist_km)
                + _destination_penalty(driver, load)
                + _rating_bonus(driver)
            )
            cost[i, j] = c

    # Solve assignment (minimise cost)
    row_idx, col_idx = linear_sum_assignment(cost)

    assignments = []
    matched_loads = set()
    matched_drivers = set()

    for r, c in zip(row_idx, col_idx):
        if cost[r, c] >= _INFEASIBLE_THRESHOLD:
            continue  # infeasible pairing – skip
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
