import logging
import math
from datetime import datetime, timedelta
from typing import Dict, List

logger = logging.getLogger(__name__)


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great-circle distance between two points in kilometres.

    Uses the Haversine formula with Earth's mean radius of 6371 km.

    Args:
        lat1: Latitude of point 1 in degrees.
        lon1: Longitude of point 1 in degrees.
        lat2: Latitude of point 2 in degrees.
        lon2: Longitude of point 2 in degrees.

    Returns:
        Distance in kilometres.
    """
    R = 6371.0  # Earth radius in km

    lat1_r, lon1_r = math.radians(lat1), math.radians(lon1)
    lat2_r, lon2_r = math.radians(lat2), math.radians(lon2)

    dlat = lat2_r - lat1_r
    dlon = lon2_r - lon1_r

    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(dlon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return R * c


# Maximum detour threshold as a fraction of the total trip distance.
# Loads whose detour exceeds this fraction of (distance_to_pickup + load_distance)
# are filtered out to prevent profit-negative recommendations.
MAX_DETOUR_FRACTION = 0.5


def find_return_loads(
    driver_destination: Dict,
    truck_specs: Dict,
    arrival_time: str,
    available_loads: List[Dict],
) -> dict:
    """Find optimal return loads to minimise empty (deadhead) return trips.

    Scores each available load based on:
      - Proximity to the driver's current destination (haversine distance)
      - Truck capacity and dimension compatibility
      - Time feasibility against the load's pickup deadline
      - Earnings per kilometre of detour
      - Detour threshold (MAX_DETOUR_FRACTION of total trip km)

    Args:
        driver_destination: Dict with 'lat' and 'lng' of the driver's drop-off point.
        truck_specs: Dict with 'max_weight_kg', 'max_length_m', 'max_width_m',
                     'max_height_m'.
        arrival_time: ISO-8601 datetime string for when the driver arrives at
                      the destination.
        available_loads: List of load dicts, each containing 'load_id',
                        'origin_lat', 'origin_lng', 'dest_lat', 'dest_lng',
                        'weight_kg', 'length_m', 'width_m', 'height_m',
                        'pickup_deadline' (ISO string), 'payment_inr'.

    Returns:
        Dict with 'recommendations': list of scored load dicts sorted by
        match_score descending (top 10).
    """
    if not available_loads:
        return {"recommendations": []}

    dest_lat = driver_destination.get("lat", 0.0)
    dest_lng = driver_destination.get("lng", 0.0)
    max_weight = truck_specs.get("max_weight_kg", 0.0)
    max_length = truck_specs.get("max_length_m", 0.0)
    max_width = truck_specs.get("max_width_m", 0.0)
    max_height = truck_specs.get("max_height_m", 0.0)

    try:
        arrival_dt = datetime.fromisoformat(arrival_time)
    except (ValueError, TypeError):
        logger.warning("Invalid arrival_time '%s'; using current time", arrival_time)
        arrival_dt = datetime.now()

    # Average truck speed assumption for time feasibility
    avg_speed_kmh = 40.0

    recommendations = []

    for load in available_loads:
        try:
            # --- Capacity check ---
            if load.get("weight_kg", 0) > max_weight:
                continue
            if load.get("length_m", 0) > max_length:
                continue
            if load.get("width_m", 0) > max_width:
                continue
            if load.get("height_m", 0) > max_height:
                continue

            # --- Distance calculations ---
            origin_lat = load.get("origin_lat", 0.0)
            origin_lng = load.get("origin_lng", 0.0)
            load_dest_lat = load.get("dest_lat", 0.0)
            load_dest_lng = load.get("dest_lng", 0.0)

            distance_to_pickup = _haversine(dest_lat, dest_lng, origin_lat, origin_lng)
            load_distance = _haversine(origin_lat, origin_lng, load_dest_lat, load_dest_lng)
            detour_km = distance_to_pickup  # Extra distance to reach the load's origin

            # --- Time feasibility ---
            try:
                deadline_dt_raw = datetime.fromisoformat(load.get("pickup_deadline", ""))
                deadline_dt = deadline_dt_raw.replace(tzinfo=None)
            except (ValueError, TypeError):
                # Skip loads with unparseable deadlines
                continue

            travel_hours = distance_to_pickup / avg_speed_kmh if avg_speed_kmh > 0 else float("inf")
            estimated_arrival = arrival_dt + timedelta(hours=travel_hours)
            if estimated_arrival > deadline_dt:
                continue  # Cannot reach in time

            # --- Detour threshold ---
            total_trip_km = distance_to_pickup + load_distance
            if total_trip_km > 0 and detour_km / total_trip_km > MAX_DETOUR_FRACTION:
                continue

            # --- Scoring ---
            payment = load.get("payment_inr", 0.0)

            # Proximity score: inversely proportional to pickup distance (max 40 pts)
            max_proximity_km = 200.0
            proximity_score = max(0.0, 1.0 - distance_to_pickup / max_proximity_km) * 40.0

            # Earnings per km (max 35 pts)
            earnings_per_km = payment / total_trip_km if total_trip_km > 0 else 0.0
            earnings_score = min(earnings_per_km / 30.0, 1.0) * 35.0  # 30 INR/km = full score

            # Time buffer score: more buffer = better (max 25 pts)
            time_buffer_hours = (deadline_dt - estimated_arrival).total_seconds() / 3600.0
            time_score = min(time_buffer_hours / 12.0, 1.0) * 25.0

            match_score = proximity_score + earnings_score + time_score

            recommendations.append({
                "load_id": load.get("load_id", ""),
                "distance_to_pickup_km": round(distance_to_pickup, 2),
                "match_score": round(match_score, 2),
                "detour_km": round(detour_km, 2),
                "estimated_earnings": round(payment, 2),
            })

        except Exception as e:
            logger.warning("Error scoring load '%s': %s", load.get("load_id", "unknown"), e)
            continue

    # Sort by match_score descending, return top 10
    recommendations.sort(key=lambda x: x["match_score"], reverse=True)
    return {"recommendations": recommendations[:10]}
