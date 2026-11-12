"""Model #16: Cargo & Payload Multi-Load Optimiser.

Selects compatible freight loads using weight and volume constraints, builds
pickup-before-delivery routes, and estimates road distance through OSRM with
a Haversine fallback.

Note: This module performs aggregate weight/volume optimisation. It does not
perform physical 3D box placement because individual cargo dimensions and
orientation constraints are not part of the input schema.
"""

from __future__ import annotations

import json
import logging
import math
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict, List, Optional, Set, Tuple

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, validator

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Model #16: Cargo & Payload Optimiser"])

Coordinate = Tuple[float, float]

# ============================================================
# 1. PYDANTIC SCHEMAS
# ============================================================

def validate_coordinate_pair(value: List[float], field_name: str):
    """Validate latitude and longitude coordinates."""
    if len(value) != 2:
        raise ValueError(f"{field_name} must contain [latitude, longitude].")

    lat, lon = value

    if not math.isfinite(lat) or not math.isfinite(lon):
        raise ValueError("Coordinates must be finite numbers.")

    if not -90 <= lat <= 90:
        raise ValueError("Latitude must be between -90 and 90.")

    if not -180 <= lon <= 180:
        raise ValueError("Longitude must be between -180 and 180.")

    return value


class LoadItem(BaseModel):
    load_id: str = Field(..., min_length=1)
    weight_kg: float = Field(..., ge=0, allow_inf_nan=False)
    volume_m3: float = Field(..., ge=0, allow_inf_nan=False)
    origin: List[float] = Field(..., min_length=2, max_length=2)
    destination: List[float] = Field(..., min_length=2, max_length=2)
    freight_amount: float = Field(..., ge=0, allow_inf_nan=False)

    @validator("load_id")
    def validate_load_id(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("load_id cannot be empty.")
        return value

    @validator("origin", "destination")
    def validate_coordinates(cls, value):
        return validate_coordinate_pair(value, "origin/destination")


class LoadOptimiserInput(BaseModel):
    truck_payload_kg: float = Field(..., gt=0, allow_inf_nan=False)
    truck_volume_m3: float = Field(..., gt=0, allow_inf_nan=False)
    available_loads: List[LoadItem]
    driver_location: List[float] = Field(
        ..., min_length=2, max_length=2
    )
    top_k: int = Field(5, ge=1, le=20)

    @validator("driver_location")
    def validate_driver_location(cls, value):
        return validate_coordinate_pair(value, "driver_location")

    @validator("available_loads")
    def validate_unique_load_ids(cls, loads):
        ids = [load.load_id for load in loads]

        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate load IDs are not allowed.")

        return loads


class RouteStop(BaseModel):
    type: str
    load_id: Optional[str] = None
    location: List[float]
    description: str


class LoadCombination(BaseModel):
    combination_id: str
    load_ids: List[str]
    loads: List[LoadItem]
    total_weight_kg: float
    total_volume_m3: float
    weight_fill_percent: float
    volume_fill_percent: float
    payload_fill_percent: float
    total_freight_amount: float
    estimated_distance_km: float
    estimated_duration_hours: float
    route_sequence: List[RouteStop]
    score: float
    recommendation_reason: str


class LoadOptimiserOutput(BaseModel):
    success: bool
    model_id: int = 16
    model_name: str = "Cargo & Payload Multi-Load Optimiser"
    truck_payload_kg: float
    truck_volume_m3: float
    driver_location: List[float]
    total_available_loads: int
    feasible_combinations_count: int
    combinations: List[LoadCombination]


# ============================================================
# 2. DISTANCE AND GEOMETRY UTILITIES
# ============================================================

EARTH_RADIUS_KM = 6371.0
CIRCUITY_FACTOR = 1.25
AVG_TRUCK_SPEED_KMH = 45.0
OSRM_TIMEOUT_SECONDS = float(
    os.getenv("OSRM_TIMEOUT_SECONDS", "1.0")
)


def haversine_km(lat1, lon1, lat2, lon2):
    """Calculate great-circle distance between two coordinates."""

    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)

    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lon / 2) ** 2
    )

    a = min(1.0, max(0.0, a))

    return (
        2 * EARTH_RADIUS_KM
        * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    )


def haversine_route_estimate(points):
    """Estimate route distance when OSRM is unavailable."""

    distance = sum(
        haversine_km(
            *points[i],
            *points[i + 1]
        ) * CIRCUITY_FACTOR
        for i in range(len(points) - 1)
    )

    distance = round(distance, 1)
    duration = round(distance / AVG_TRUCK_SPEED_KMH, 2)

    return distance, duration


def query_osrm_distance(points):
    """Get driving distance and duration using OSRM."""

    if len(points) < 2:
        return 0.0, 0.0

    osrm_url = os.getenv(
        "OSRM_BASE_URL",
        "http://localhost:5002"
    ).rstrip("/")

    coordinates = ";".join(
        f"{lon:.6f},{lat:.6f}"
        for lat, lon in points
    )

    query = urllib.parse.urlencode({
        "overview": "false",
        "steps": "false"
    })

    url = (
        f"{osrm_url}/route/v1/driving/"
        f"{coordinates}?{query}"
    )

    try:
        request = urllib.request.Request(
            url,
            headers={"User-Agent": "Truxify-ML-Engine"}
        )

        with urllib.request.urlopen(
            request,
            timeout=OSRM_TIMEOUT_SECONDS
        ) as response:

            if response.status != 200:
                raise RuntimeError("OSRM request failed.")

            data = json.loads(
                response.read().decode("utf-8")
            )

            routes = data.get("routes") or []

            if data.get("code") != "Ok" or not routes:
                raise RuntimeError("Invalid OSRM route response.")

            distance = float(routes[0]["distance"])
            duration = float(routes[0]["duration"])

            if (
                not math.isfinite(distance)
                or not math.isfinite(duration)
                or distance < 0
                or duration < 0
            ):
                raise ValueError("Invalid OSRM distance or duration.")

            return (
                round(distance / 1000, 1),
                round(duration / 3600, 2)
            )

    except (
        urllib.error.URLError,
        TimeoutError,
        ValueError,
        KeyError,
        TypeError,
        json.JSONDecodeError,
        RuntimeError
    ) as error:

        logger.warning(
            "OSRM unavailable. Using Haversine fallback: %s",
            error
        )

        return haversine_route_estimate(points)


# ============================================================
# 3. PICKUP AND DELIVERY ROUTE SEQUENCING
# ============================================================

def sequence_stops(driver_loc, loads):
    """
    Generate route stops using nearest-stop selection.

    Ensures each load is picked up before its delivery.
    """

    stops = [
        RouteStop(
            type="start",
            load_id=None,
            location=[
                driver_loc[0],
                driver_loc[1]
            ],
            description="Driver Start Location"
        )
    ]

    point_coords = [driver_loc]

    picked_up = set()
    delivered = set()

    current_pos = driver_loc

    while len(delivered) < len(loads):

        candidates = []

        for load in loads:

            if load.load_id not in picked_up:

                candidates.append((
                    "pickup",
                    load.load_id,
                    tuple(load.origin),
                    f"Pickup {load.load_id} "
                    f"({load.weight_kg} kg, {load.volume_m3} m3)"
                ))

            elif load.load_id not in delivered:

                candidates.append((
                    "destination",
                    load.load_id,
                    tuple(load.destination),
                    f"Deliver {load.load_id}"
                ))

        if not candidates:
            logger.error(
                "Route sequencing stopped before all deliveries."
            )
            break

        best_stop = min(
            candidates,
            key=lambda candidate: haversine_km(
                current_pos[0],
                current_pos[1],
                candidate[2][0],
                candidate[2][1]
            )
        )

        stop_type, load_id, location, description = best_stop

        stops.append(
            RouteStop(
                type=stop_type,
                load_id=load_id,
                location=list(location),
                description=description
            )
        )

        point_coords.append(location)
        current_pos = location

        if stop_type == "pickup":
            picked_up.add(load_id)
        else:
            delivered.add(load_id)

    return stops, point_coords


# ============================================================
# 4. COMBINATION EVALUATION
# ============================================================

def compute_combination_details(
    candidate_loads,
    truck_weight,
    truck_volume,
    driver_loc,
    combo_index
):
    """Calculate capacity, route, revenue and recommendation."""

    total_weight = sum(
        load.weight_kg for load in candidate_loads
    )

    total_volume = sum(
        load.volume_m3 for load in candidate_loads
    )

    total_revenue = sum(
        load.freight_amount for load in candidate_loads
    )

    weight_fill = round(
        (total_weight / truck_weight) * 100, 1
    )

    volume_fill = round(
        (total_volume / truck_volume) * 100, 1
    )

    payload_fill = max(
        weight_fill,
        volume_fill
    )

    route_stops, points = sequence_stops(
        driver_loc,
        candidate_loads
    )

    distance, duration = query_osrm_distance(points)

    earnings_per_km = (
        total_revenue / max(distance, 1.0)
    )

    revenue_score = min(total_revenue / 10000, 1.0)
    capacity_score = min(payload_fill / 100, 1.0)
    efficiency_score = min(earnings_per_km / 100, 1.0)

    score = round(
        0.50 * revenue_score
        + 0.30 * capacity_score
        + 0.20 * efficiency_score,
        3
    )

    if len(candidate_loads) > 1 and payload_fill >= 80:

        reason = (
            f"High Capacity Multi-Load "
            f"({len(candidate_loads)} shipments): "
            f"{payload_fill}% utilization, "
            f"Rs. {total_revenue:,.2f} earnings"
        )

    elif len(candidate_loads) > 1:

        reason = (
            f"Multi-Drop Consolidation: "
            f"{len(candidate_loads)} loads, "
            f"Rs. {earnings_per_km:.2f}/km efficiency"
        )

    else:

        reason = (
            f"Single Direct Load: "
            f"{payload_fill}% capacity utilization"
        )

    return LoadCombination(
        combination_id=f"COMBO-{combo_index}",
        load_ids=[
            load.load_id for load in candidate_loads
        ],
        loads=candidate_loads,
        total_weight_kg=round(total_weight, 2),
        total_volume_m3=round(total_volume, 2),
        weight_fill_percent=weight_fill,
        volume_fill_percent=volume_fill,
        payload_fill_percent=payload_fill,
        total_freight_amount=round(total_revenue, 2),
        estimated_distance_km=distance,
        estimated_duration_hours=duration,
        route_sequence=route_stops,
        score=score,
        recommendation_reason=reason
    )


# ============================================================
# 5. MULTI-DIMENSIONAL BIN PACKING OPTIMISATION
# ============================================================

def solve_load_optimisation(
    truck_payload_kg,
    truck_volume_m3,
    available_loads,
    driver_location,
    top_k=5
):
    """
    Generate feasible combinations using greedy heuristics
    and local search.
    """

    if truck_payload_kg <= 0 or truck_volume_m3 <= 0:
        raise ValueError("Truck capacities must be positive.")

    if top_k < 1:
        raise ValueError("top_k must be at least 1.")

    load_ids = [load.load_id for load in available_loads]

    if len(load_ids) != len(set(load_ids)):
        raise ValueError("Load IDs must be unique.")

    valid_loads = [
        load for load in available_loads
        if load.weight_kg <= truck_payload_kg
        and load.volume_m3 <= truck_volume_m3
    ]

    if not valid_loads:
        return []

    def fits(weight, volume, load):
        return (
            weight + load.weight_kg <= truck_payload_kg
            and volume + load.volume_m3 <= truck_volume_m3
        )

    def get_density(load):

        normalized_weight = (
            load.weight_kg / truck_payload_kg
        )

        normalized_volume = (
            load.volume_m3 / truck_volume_m3
        )

        consumption = max(
            0.5 * normalized_weight
            + 0.5 * normalized_volume,
            0.001
        )

        return load.freight_amount / consumption

    discovered_combos = {}

    def register_combo(candidate):

        if not candidate:
            return

        ids = [load.load_id for load in candidate]

        if len(ids) != len(set(ids)):
            return

        total_weight = sum(
            load.weight_kg for load in candidate
        )

        total_volume = sum(
            load.volume_m3 for load in candidate
        )

        if (
            total_weight <= truck_payload_kg
            and total_volume <= truck_volume_m3
        ):

            key = frozenset(ids)

            discovered_combos.setdefault(
                key,
                list(candidate)
            )

    def greedy_build(sorted_loads):

        selected = []
        weight = 0.0
        volume = 0.0

        for load in sorted_loads:

            if fits(weight, volume, load):

                selected.append(load)

                weight += load.weight_kg
                volume += load.volume_m3

        return selected

    # Seed A: Density-first greedy
    density_sorted = sorted(
        valid_loads,
        key=get_density,
        reverse=True
    )

    register_combo(
        greedy_build(density_sorted)
    )

    # Seed B: Revenue-first greedy
    revenue_sorted = sorted(
        valid_loads,
        key=lambda load: (
            load.freight_amount,
            get_density(load)
        ),
        reverse=True
    )

    register_combo(
        greedy_build(revenue_sorted)
    )

    # Seed C: Proximity-first greedy
    proximity_sorted = sorted(
        valid_loads,
        key=lambda load: haversine_km(
            driver_location[0],
            driver_location[1],
            load.origin[0],
            load.origin[1]
        )
    )

    register_combo(
        greedy_build(proximity_sorted)
    )

    # Seed D: Single-load alternatives
    for load in revenue_sorted[:10]:
        register_combo([load])

    # Local search
    base_combos = list(
        discovered_combos.values()
    )

    for combo in base_combos:

        current_ids = {
            load.load_id for load in combo
        }

        unselected = [
            load for load in valid_loads
            if load.load_id not in current_ids
        ]

        # Greedy filling
        extended = list(combo)

        used_weight = sum(
            load.weight_kg for load in extended
        )

        used_volume = sum(
            load.volume_m3 for load in extended
        )

        for candidate in sorted(
            unselected,
            key=get_density,
            reverse=True
        ):

            if fits(
                used_weight,
                used_volume,
                candidate
            ):

                extended.append(candidate)

                used_weight += candidate.weight_kg
                used_volume += candidate.volume_m3

        register_combo(extended)

        # One-for-one swap
        for index in range(len(combo)):

            for candidate in unselected:

                swapped = list(combo)
                swapped[index] = candidate

                register_combo(swapped)

    # Evaluate combinations
    evaluated = []

    for index, combination in enumerate(
        discovered_combos.values(),
        start=1
    ):

        result = compute_combination_details(
            candidate_loads=combination,
            truck_weight=truck_payload_kg,
            truck_volume=truck_volume_m3,
            driver_loc=driver_location,
            combo_index=index
        )

        evaluated.append(result)

    # Rank combinations
    evaluated.sort(
        key=lambda combination: (
            combination.score,
            combination.total_freight_amount,
            combination.payload_fill_percent,
            len(combination.load_ids)
        ),
        reverse=True
    )

    ranked = evaluated[:top_k]

    for rank, combination in enumerate(
        ranked,
        start=1
    ):

        combination.combination_id = (
            f"COMBO-{rank}"
        )

    return ranked


# ============================================================
# 6. FASTAPI ROUTER ENDPOINTS
# ============================================================

@router.post(
    "/api/ml/load-optimiser",
    response_model=LoadOptimiserOutput
)
@router.post(
    "/load-optimiser",
    response_model=LoadOptimiserOutput
)
def optimise_loads_endpoint(
    payload: LoadOptimiserInput
) -> LoadOptimiserOutput:

    """Optimise multi-load assignments within truck constraints."""

    try:

        driver_location = (
            payload.driver_location[0],
            payload.driver_location[1]
        )

        combinations = solve_load_optimisation(
            truck_payload_kg=payload.truck_payload_kg,
            truck_volume_m3=payload.truck_volume_m3,
            available_loads=payload.available_loads,
            driver_location=driver_location,
            top_k=payload.top_k
        )

        return LoadOptimiserOutput(
            success=True,
            model_id=16,
            model_name="Cargo & Payload Multi-Load Optimiser",
            truck_payload_kg=payload.truck_payload_kg,
            truck_volume_m3=payload.truck_volume_m3,
            driver_location=payload.driver_location,
            total_available_loads=len(
                payload.available_loads
            ),
            feasible_combinations_count=len(
                combinations
            ),
            combinations=combinations
        )

    except ValueError as error:

        logger.warning(
            "Invalid optimisation request: %s",
            error
        )

        raise HTTPException(
            status_code=422,
            detail=str(error)
        ) from error

    except Exception as error:

        logger.exception(
            "Load optimiser failed"
        )

        raise HTTPException(
            status_code=500,
            detail="Load optimisation failed. Please try again later."
        ) from error
