import logging
import math
from datetime import datetime, timedelta
from typing import Dict, List

logger = logging.getLogger(__name__)

# Average truck speed assumption for detour time estimation
_AVG_SPEED_KMH = 35.0


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


def find_mid_trip_loads(
    current_location: Dict,
    remaining_route: List[Dict],
    available_capacity: Dict,
    nearby_loads: List[Dict],
) -> dict:
    """Suggest additional pickups that can be added during an active trip.

    For each nearby load the algorithm:
      1. Filters by remaining truck capacity (weight and dimensions).
      2. Calculates detour: dist(current→pickup) + dist(pickup→dropoff) +
         dist(dropoff→next_waypoint) − dist(current→next_waypoint).
      3. Scores by earnings/detour ratio, proximity, and deadline feasibility.
      4. Returns the top 5 recommendations sorted by priority_score.

    Args:
        current_location: Dict with 'lat' and 'lng'.
        remaining_route: List of waypoint dicts with 'lat' and 'lng'.
        available_capacity: Dict with 'weight_kg', 'length_m', 'width_m',
                            'height_m' of remaining truck capacity.
        nearby_loads: List of load dicts, each with 'load_id', 'pickup_lat',
                      'pickup_lng', 'dropoff_lat', 'dropoff_lng', 'weight_kg',
                      'length_m', 'width_m', 'height_m', 'payment_inr',
                      'pickup_deadline' (ISO string).

    Returns:
        Dict with 'recommendations': list of scored load dicts sorted by
        priority_score descending (top 5).
    """
    if not nearby_loads:
        return {"recommendations": []}

    cur_lat = current_location.get("lat", 0.0)
    cur_lng = current_location.get("lng", 0.0)

    cap_weight = available_capacity.get("weight_kg", 0.0)
    cap_length = available_capacity.get("length_m", 0.0)
    cap_width = available_capacity.get("width_m", 0.0)
    cap_height = available_capacity.get("height_m", 0.0)

    # Next waypoint for detour calculation
    if remaining_route:
        next_wp = remaining_route[0]
        next_lat = next_wp.get("lat", cur_lat)
        next_lng = next_wp.get("lng", cur_lng)
    else:
        # No remaining route – treat current location as next waypoint
        next_lat = cur_lat
        next_lng = cur_lng

    # Baseline distance: current -> next waypoint (without detour)
    baseline_dist = _haversine(cur_lat, cur_lng, next_lat, next_lng)

    now = datetime.now()
    recommendations = []

    for load in nearby_loads:
        try:
            # --- 1. Capacity filter ---
            if load.get("weight_kg", 0) > cap_weight:
                continue
            if load.get("length_m", 0) > cap_length:
                continue
            if load.get("width_m", 0) > cap_width:
                continue
            if load.get("height_m", 0) > cap_height:
                continue

            pickup_lat = load.get("pickup_lat", 0.0)
            pickup_lng = load.get("pickup_lng", 0.0)
            dropoff_lat = load.get("dropoff_lat", 0.0)
            dropoff_lng = load.get("dropoff_lng", 0.0)

            # --- 2. Detour calculation ---
            dist_cur_pickup = _haversine(cur_lat, cur_lng, pickup_lat, pickup_lng)
            dist_pickup_dropoff = _haversine(pickup_lat, pickup_lng, dropoff_lat, dropoff_lng)
            dist_dropoff_next = _haversine(dropoff_lat, dropoff_lng, next_lat, next_lng)

            detour_km = (
                dist_cur_pickup + dist_pickup_dropoff + dist_dropoff_next
                - baseline_dist
            )
            detour_km = max(detour_km, 0.0)  # Floor at zero

            detour_minutes = (detour_km / _AVG_SPEED_KMH) * 60.0 if _AVG_SPEED_KMH > 0 else 0.0

            # --- 3. Deadline feasibility ---
            try:
                deadline_dt = datetime.fromisoformat(load.get("pickup_deadline", ""))
            except (ValueError, TypeError):
                continue  # Skip loads with unparseable deadlines

            travel_hours_to_pickup = dist_cur_pickup / _AVG_SPEED_KMH if _AVG_SPEED_KMH > 0 else float("inf")
            estimated_pickup_time = now + timedelta(hours=travel_hours_to_pickup)

            if estimated_pickup_time > deadline_dt:
                continue  # Cannot reach pickup in time

            # --- 4. Scoring ---
            payment = load.get("payment_inr", 0.0)

            # Earnings per km of detour (max 40 pts)
            if detour_km > 0:
                earnings_per_km = payment / detour_km
            else:
                # Zero detour = perfect efficiency
                earnings_per_km = payment if payment > 0 else 0.0
            earnings_score = min(earnings_per_km / 50.0, 1.0) * 40.0

            # Proximity score: closer pickups are better (max 30 pts)
            max_proximity_km = 100.0
            proximity_score = max(0.0, 1.0 - dist_cur_pickup / max_proximity_km) * 30.0

            # Time buffer score (max 30 pts)
            time_buffer_hours = (deadline_dt - estimated_pickup_time).total_seconds() / 3600.0
            time_score = min(time_buffer_hours / 6.0, 1.0) * 30.0

            priority_score = earnings_score + proximity_score + time_score

            recommendations.append({
                "load_id": load.get("load_id", ""),
                "detour_km": round(detour_km, 2),
                "detour_minutes": round(detour_minutes, 2),
                "additional_earnings": round(payment, 2),
                "priority_score": round(priority_score, 2),
                "pickup_location": {
                    "lat": pickup_lat,
                    "lng": pickup_lng,
                },
                "dropoff_location": {
                    "lat": dropoff_lat,
                    "lng": dropoff_lng,
                },
            })

        except Exception as e:
            logger.warning("Error scoring load '%s': %s", load.get("load_id", "unknown"), e)
            continue

    # Sort by priority_score descending, return top 5
    recommendations.sort(key=lambda x: x["priority_score"], reverse=True)
    return {"recommendations": recommendations[:5]}
