import logging
import math

logger = logging.getLogger(__name__)

# NOTE: This module uses hardcoded base rates (BASE_RATE_PER_KM, BASE_RATE_PER_KG)
# and static truck-type multipliers rather than a trained ML model. Replace these
# constants with model-based predictions trained on actual completed trip pricing
# data (distance, time-of-day, demand level, driver availability, etc.) for
# accurate, data-driven price estimation.

TRUCK_TYPE_MULTIPLIERS = {
    "light_truck": 1.0,
    "medium_truck": 1.2,
    "heavy_truck": 1.5,
    "trailer": 1.8,
}

DEFAULT_TRUCK_MULTIPLIER = 1.0
BASE_RATE_PER_KM = 6.0
BASE_RATE_PER_KG = 0.005
MIN_PRICE = 500.0


def predict_price(
    distance_km: float,
    cargo_weight_kg: float,
    truck_type: str = "medium_truck",
    route_origin: str = "",
    route_destination: str = "",
) -> float:
    if distance_km <= 0:
        raise ValueError("distance_km must be positive")
    if cargo_weight_kg <= 0:
        raise ValueError("cargo_weight_kg must be positive")

    truck_mult = TRUCK_TYPE_MULTIPLIERS.get(
        truck_type.lower().replace(" ", "_"), DEFAULT_TRUCK_MULTIPLIER
    )

    distance_cost = distance_km * BASE_RATE_PER_KM * truck_mult
    weight_cost = cargo_weight_kg * BASE_RATE_PER_KG
    estimated_price = distance_cost + weight_cost

    return max(round(estimated_price, 2), MIN_PRICE)
