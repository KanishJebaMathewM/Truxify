import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Dict, List

from utils.osrm_client import get_route_matrix_with_duration

logger = logging.getLogger(__name__)

# Average speed is retained only by the legacy geometric fallback helper. The
# recommender itself uses OSRM road durations whenever the route engine is available.
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
    """Return total geometric distance from current location through route."""
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
    """Legacy geometric insertion helper retained for compatibility."""
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

            extra_distance = max(pickup_delta + dropoff_delta, 0.0)
            if extra_distance < best_extra_distance:
                best_extra_distance = extra_distance
                best_pickup_distance = pickup_distance

    if best_extra_distance == float("inf"):
        return 0.0, _route_distance(current_location, [pickup_location])

    return best_extra_distance, best_pickup_distance


def _sequence_total(matrix: List[List[float]], sequence: List[int]) -> float:
    return sum(matrix[sequence[index]][sequence[index + 1]] for index in range(len(sequence) - 1))


def _route_insertion_options_with_matrix(
    base_route_indices: List[int],
    pickup_index: int,
    dropoff_index: int,
    distance_matrix: List[List[float]],
    duration_matrix: List[List[float]],
) -> List[tuple[float, float, float, float]]:
    """Return distance/duration data for every valid pickup/dropoff insertion."""
    baseline_distance = _sequence_total(distance_matrix, base_route_indices)
    baseline_duration = _sequence_total(duration_matrix, base_route_indices)
    route_length = len(base_route_indices) - 1

    options: List[tuple[float, float, float, float]] = []

    for pickup_position in range(route_length + 1):
        augmented = (
            base_route_indices[: pickup_position + 1]
            + [pickup_index]
            + base_route_indices[pickup_position + 1 :]
        )
        pickup_position_in_augmented = pickup_position + 1
        pickup_distance = _sequence_total(
            distance_matrix,
            augmented[: pickup_position_in_augmented + 1],
        )
        pickup_duration = _sequence_total(
            duration_matrix,
            augmented[: pickup_position_in_augmented + 1],
        )

        for dropoff_position in range(
            pickup_position_in_augmented + 1,
            len(augmented) + 1,
        ):
            candidate = (
                augmented[:dropoff_position]
                + [dropoff_index]
                + augmented[dropoff_position:]
            )
            candidate_distance = _sequence_total(distance_matrix, candidate)
            candidate_duration = _sequence_total(duration_matrix, candidate)
            extra_distance = max(candidate_distance - baseline_distance, 0.0)
            extra_duration = max(candidate_duration - baseline_duration, 0.0)
            options.append(
                (
                    extra_distance,
                    extra_duration,
                    pickup_distance,
                    pickup_duration,
                )
            )

    return options


def _best_route_insertion_with_matrix(
    base_route_indices: List[int],
    pickup_index: int,
    dropoff_index: int,
    distance_matrix: List[List[float]],
    duration_matrix: List[List[float]],
) -> tuple[float, float, float, float]:
    """Return the minimum-distance matrix insertion for compatibility."""
    return min(
        _route_insertion_options_with_matrix(
            base_route_indices,
            pickup_index,
            dropoff_index,
            distance_matrix,
            duration_matrix,
        ),
        key=lambda option: (option[0], option[1], option[2], option[3]),
    )


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

    candidate_loads = []
    for load in nearby_loads:
        if load.get("weight_kg", 0) > cap_weight:
            continue
        if load.get("length_m", 0) > cap_length:
            continue
        if load.get("width_m", 0) > cap_width:
            continue
        if load.get("height_m", 0) > cap_height:
            continue
        candidate_loads.append(load)

    if not candidate_loads:
        return {"recommendations": []}

    pickup_locations = [
        (load.get("pickup_lat", 0.0), load.get("pickup_lng", 0.0))
        for load in candidate_loads
    ]
    dropoff_locations = [
        (load.get("dropoff_lat", 0.0), load.get("dropoff_lng", 0.0))
        for load in candidate_loads
    ]

    locations = [
        (cur_lat, cur_lng),
        *remaining_route_points,
        *pickup_locations,
        *dropoff_locations,
    ]
    distance_matrix, duration_matrix = get_route_matrix_with_duration(locations)

    remaining_route_indices = list(range(1, len(remaining_route_points) + 1))
    base_route_indices = [0] + remaining_route_indices
    pickup_offset = 1 + len(remaining_route_points)
    dropoff_offset = pickup_offset + len(candidate_loads)

    now = datetime.now(timezone.utc)
    recommendations = []

    for load_index, load in enumerate(candidate_loads):
        try:
            pickup_lat, pickup_lng = pickup_locations[load_index]
            dropoff_lat, dropoff_lng = dropoff_locations[load_index]
            pickup_idx = pickup_offset + load_index
            dropoff_idx = dropoff_offset + load_index

            insertion_options = _route_insertion_options_with_matrix(
                base_route_indices,
                pickup_idx,
                dropoff_idx,
                distance_matrix,
                duration_matrix,
            )

            deadline_dt = datetime.fromisoformat(load.get("pickup_deadline", ""))
            if deadline_dt.tzinfo is None:
                deadline_dt = deadline_dt.replace(tzinfo=timezone.utc)
            else:
                deadline_dt = deadline_dt.astimezone(timezone.utc)

            feasible_options = []
            for option in insertion_options:
                estimated_pickup_time = now + timedelta(minutes=option[3])
                if estimated_pickup_time <= deadline_dt:
                    feasible_options.append((option, estimated_pickup_time))

            if not feasible_options:
                continue

            (detour_km, detour_minutes, pickup_route_distance, pickup_route_minutes), estimated_pickup_time = min(
                feasible_options,
                key=lambda item: (
                    item[0][0],
                    item[0][1],
                    item[0][2],
                    item[0][3],
                ),
            )

            dist_cur_pickup = distance_matrix[0][pickup_idx]
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

        except (ValueError, TypeError, KeyError):
            continue
        except Exception as e:
            logger.warning(
                "Error scoring load '%s': %s", load.get("load_id", "unknown"), e
            )
            continue

    recommendations.sort(key=lambda x: x["priority_score"], reverse=True)
    return {"recommendations": recommendations[:5]}
