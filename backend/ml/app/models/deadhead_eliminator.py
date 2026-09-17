import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Dict, List

logger = logging.getLogger(__name__)

_EARTH_RADIUS_KM = 6371.0

_DEFAULT_FUEL_PRICE_INR_PER_L = 100.0
_DEFAULT_FUEL_EFFICIENCY_KM_PER_L = 5.0
_DEFAULT_TOLL_PER_KM_INR = 1.5
_DEFAULT_OPERATING_COST_PER_KM_INR = 1.5


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great-circle distance between two points in kilometres."""
    lat1_r, lon1_r = math.radians(lat1), math.radians(lon1)
    lat2_r, lon2_r = math.radians(lat2), math.radians(lon2)
    dlat = lat2_r - lat1_r
    dlon = lon2_r - lon1_r
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(dlon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return _EARTH_RADIUS_KM * c


def _to_naive(dt: datetime) -> datetime:
    """Normalize a datetime to UTC while preserving its absolute instant."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _positive_cost(value: object, name: str, default: float, *, allow_zero: bool = False) -> float:
    if value is None:
        return default
    try:
        numeric_value = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a finite number") from exc
    if not math.isfinite(numeric_value) or (numeric_value < 0 if allow_zero else numeric_value <= 0):
        comparator = "non-negative" if allow_zero else "greater than zero"
        raise ValueError(f"{name} must be a finite value {comparator}")
    return numeric_value


MAX_DETOUR_FRACTION = 0.5


def find_return_loads(
    driver_destination: Dict,
    truck_specs: Dict,
    arrival_time: str,
    available_loads: List[Dict],
) -> dict:
    """Find return loads and rank them by incremental net profit.

    The ranking contract is based on incremental economics, not gross revenue:
    ``net_profit = payment - fuel - toll - operating_cost``. A load with a
    non-positive incremental profit is not recommended.
    """
    if not available_loads:
        return {"recommendations": []}

    dest_lat = driver_destination.get("lat", 0.0)
    dest_lng = driver_destination.get("lng", 0.0)
    max_weight = truck_specs.get("max_weight_kg", 0.0)
    max_length = truck_specs.get("max_length_m", 0.0)
    max_width = truck_specs.get("max_width_m", 0.0)
    max_height = truck_specs.get("max_height_m", 0.0)

    fuel_price_inr_per_l = _positive_cost(
        truck_specs.get("fuel_price_inr_per_l"),
        "fuel_price_inr_per_l",
        _DEFAULT_FUEL_PRICE_INR_PER_L,
    )
    fuel_efficiency_km_per_l = _positive_cost(
        truck_specs.get("fuel_efficiency_km_per_l"),
        "fuel_efficiency_km_per_l",
        _DEFAULT_FUEL_EFFICIENCY_KM_PER_L,
    )
    toll_per_km_inr = _positive_cost(
        truck_specs.get("toll_per_km_inr"),
        "toll_per_km_inr",
        _DEFAULT_TOLL_PER_KM_INR,
        allow_zero=True,
    )
    operating_cost_per_km_inr = _positive_cost(
        truck_specs.get("operating_cost_per_km_inr"),
        "operating_cost_per_km_inr",
        _DEFAULT_OPERATING_COST_PER_KM_INR,
        allow_zero=True,
    )

    try:
        arrival_dt = _to_naive(datetime.fromisoformat(arrival_time))
    except (ValueError, TypeError):
        logger.warning("Invalid arrival_time '%s'; using current time", arrival_time)
        arrival_dt = datetime.now(timezone.utc)

    avg_speed_kmh = 40.0
    recommendations = []

    for load in available_loads:
        try:
            if load.get("weight_kg", 0) > max_weight:
                continue
            if load.get("length_m", 0) > max_length:
                continue
            if load.get("width_m", 0) > max_width:
                continue
            if load.get("height_m", 0) > max_height:
                continue

            origin_lat = load.get("origin_lat", 0.0)
            origin_lng = load.get("origin_lng", 0.0)
            load_dest_lat = load.get("dest_lat", 0.0)
            load_dest_lng = load.get("dest_lng", 0.0)

            distance_to_pickup = _haversine(dest_lat, dest_lng, origin_lat, origin_lng)
            load_distance = _haversine(origin_lat, origin_lng, load_dest_lat, load_dest_lng)
            detour_km = distance_to_pickup

            try:
                deadline_dt = _to_naive(
                    datetime.fromisoformat(load.get("pickup_deadline", ""))
                )
            except (ValueError, TypeError):
                continue

            travel_hours = distance_to_pickup / avg_speed_kmh
            estimated_arrival = arrival_dt + timedelta(hours=travel_hours)
            if estimated_arrival > deadline_dt:
                continue

            total_trip_km = distance_to_pickup + load_distance
            if total_trip_km > 0 and detour_km / total_trip_km > MAX_DETOUR_FRACTION:
                continue

            payment = float(load.get("payment_inr", 0.0))
            fuel_cost = (total_trip_km / fuel_efficiency_km_per_l) * fuel_price_inr_per_l
            toll_estimate = load.get("toll_estimate_inr")
            if toll_estimate is None:
                toll_cost = total_trip_km * toll_per_km_inr
            else:
                toll_cost = _positive_cost(
                    toll_estimate,
                    "toll_estimate_inr",
                    0.0,
                    allow_zero=True,
                )
            operating_cost = total_trip_km * operating_cost_per_km_inr
            incremental_cost = fuel_cost + toll_cost + operating_cost
            incremental_profit = payment - incremental_cost

            if incremental_profit <= 0:
                continue

            max_proximity_km = 200.0
            proximity_score = max(
                0.0, 1.0 - distance_to_pickup / max_proximity_km
            ) * 30.0

            profit_per_km = incremental_profit / total_trip_km if total_trip_km > 0 else 0.0
            profitability_score = min(profit_per_km / 30.0, 1.0) * 45.0

            time_buffer_hours = (
                deadline_dt - estimated_arrival
            ).total_seconds() / 3600.0
            time_score = min(time_buffer_hours / 12.0, 1.0) * 25.0

            match_score = profitability_score + proximity_score + time_score

            recommendations.append({
                "load_id": load.get("load_id", ""),
                "distance_to_pickup_km": round(distance_to_pickup, 2),
                "match_score": round(match_score, 2),
                "detour_km": round(detour_km, 2),
                "estimated_earnings": round(payment, 2),
                "estimated_cost_inr": round(incremental_cost, 2),
                "estimated_profit_inr": round(incremental_profit, 2),
                "profit_per_km": round(profit_per_km, 2),
            })

        except ValueError:
            raise
        except Exception as e:
            logger.warning(
                "Error scoring load '%s': %s", load.get("load_id", "unknown"), e
            )
            continue

    recommendations.sort(key=lambda x: x["match_score"], reverse=True)
    return {"recommendations": recommendations[:10]}
