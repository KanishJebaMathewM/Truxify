import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Dict, List

logger = logging.getLogger(__name__)

# Average truck speed assumption for detour time estimation
_AVG_SPEED_KMH = 35.0


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great-circle distance between two points in kilometres."""
    R = 6371.0
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


def _route_distance(
    current_location: tuple[float, float], route: List[tuple[float, float]]
) -> float:
    """Return the total distance from the current location through the route."""
    total_distance = 0.0
    previous = current_location
    for waypoint in route:
        total_distance += _haversine(*previous, *waypoint)
        previous = waypoint
    return total_distance


def _best_route_insertion(
    current_location: tuple[float, float],
    remaining_route: List[tuple[float, float]],
    pickup_location: tuple[float, float],
    dropoff_location: tuple[float, float],
) -> tuple[float, float]:
    """Return the minimum route increase and travel distance to the pickup."""
    baseline_distance = _route_distance(current_location, remaining_route)
    best_extra_distance = float("inf")
    best_pickup_distance = float("inf")
    route_length = len(remaining_route)

    for pickup_index in range(route_length + 1):
        pickup_before = (
            current_location if pickup_index == 0 else remaining_route[pickup_index - 1]
        )
        pickup_after = (
            remaining_route[pickup_index] if pickup_index < route_length else None
        )
        pickup_delta = _haversine(*pickup_before, *pickup_location)
        if pickup_after is not None:
            pickup_delta += _haversine(*pickup_location, *pickup_after)
            pickup_delta -= _haversine(*pickup_before, *pickup_after)

        augmented_route = (
            remaining_route[:pickup_index]
            + [pickup_location]
            + remaining_route[pickup_index:]
        )
        pickup_distance = _route_distance(
            current_location, augmented_route[: pickup_index + 1]
        )

        for dropoff_index in range(pickup_index + 1, len(augmented_route) + 1):
            dropoff_before = augmented_route[dropoff_index - 1]
            dropoff_after = (
                augmented_route[dropoff_index]
                if dropoff_index < len(augmented_route)
                else None
            )
            dropoff_delta = _haversine(*dropoff_before, *dropoff_location)
            if dropoff_after is not None:
                dropoff_delta += _haversine(*dropoff_location, *dropoff_after)
                dropoff_delta -= _haversine(*dropoff_before, *dropoff_after)

            extra_distance = max(
                baseline_distance + pickup_delta + dropoff_delta - baseline_distance,
                0.0,
            )
            if extra_distance < best_extra_distance:
                best_extra_distance = extra_distance
                best_pickup_distance = pickup_distance

    if best_extra_distance == float("inf"):
        return 0.0, _route_distance(current_location, [pickup_location])

    return best_extra_distance, best_pickup_distance


def find_mid_trip_loads(
    current_location: Dict,
    remaining_route: List[Dict],
    available_capacity: Dict,
    nearby_loads: List[Dict],
) -> dict:
    """Suggest additional pickups that can be added during an active trip."""
    if not nearby_loads:
        return {"recommendations": []}

    cur_lat = current_location.get("lat", 0.0)
    cur_lng = current_location.get("lng", 0.0)

    cap_weight = available_capacity.get("weight_kg", 0.0)
    cap_length = available_capacity.get("length_m", 0.0)
    cap_width = available_capacity.get("width_m", 0.0)
    cap_height = available_capacity.get("height_m", 0.0)

    remaining_route_points = [
        (waypoint.get("lat", cur_lat), waypoint.get("lng", cur_lng))
        for waypoint in remaining_route
    ]

    now = datetime.now(timezone.utc)
    recommendations = []

    for load in nearby_loads:
        try:
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
            pickup_location = (pickup_lat, pickup_lng)
            dropoff_location = (dropoff_lat, dropoff_lng)

            dist_cur_pickup = _haversine(cur_lat, cur_lng, pickup_lat, pickup_lng)
            detour_km, pickup_route_distance = _best_route_insertion(
                (cur_lat, cur_lng),
                remaining_route_points,
                pickup_location,
                dropoff_location,
            )
            detour_minutes = (
                detour_km / _AVG_SPEED_KMH * 60.0
                if _AVG_SPEED_KMH > 0
                else 0.0
            )

            try:
                deadline_dt = datetime.fromisoformat(load.get("pickup_deadline", ""))
                if deadline_dt.tzinfo is None:
                    deadline_dt = deadline_dt.replace(tzinfo=timezone.utc)
                else:
                    deadline_dt = deadline_dt.astimezone(timezone.utc)

                travel_hours_to_pickup = (
                    pickup_route_distance / _AVG_SPEED_KMH
                    if _AVG_SPEED_KMH > 0
                    else float("inf")
                )
                estimated_pickup_time = now + timedelta(hours=travel_hours_to_pickup)
                if estimated_pickup_time > deadline_dt:
                    continue
            except (ValueError, TypeError):
                continue

            payment = load.get("payment_inr", 0.0)
            if detour_km > 0:
                earnings_per_km = payment / detour_km
            else:
                earnings_per_km = payment if payment > 0 else 0.0
            earnings_score = min(earnings_per_km / 50.0, 1.0) * 40.0

            max_proximity_km = 100.0
            proximity_score = max(
                0.0, 1.0 - dist_cur_pickup / max_proximity_km
            ) * 30.0

            time_buffer_hours = (
                deadline_dt - estimated_pickup_time
            ).total_seconds() / 3600.0
            time_score = min(time_buffer_hours / 6.0, 1.0) * 30.0
            priority_score = earnings_score + proximity_score + time_score

            recommendations.append(
                {
                    "load_id": load.get("load_id", ""),
                    "detour_km": round(detour_km, 2),
                    "detour_minutes": round(detour_minutes, 2),
                    "additional_earnings": round(payment, 2),
                    "priority_score": round(priority_score, 2),
                    "pickup_location": {"lat": pickup_lat, "lng": pickup_lng},
                    "dropoff_location": {"lat": dropoff_lat, "lng": dropoff_lng},
                }
            )

        except Exception as e:
            logger.warning(
                "Error scoring load '%s': %s", load.get("load_id", "unknown"), e
            )
            continue

    recommendations.sort(key=lambda x: x["priority_score"], reverse=True)
    return {"recommendations": recommendations[:5]}
