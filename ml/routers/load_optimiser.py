"""Model #16: Cargo & Payload Multi-Load Optimiser (Phase 3 Intelligence)

Solves multi-dimensional bin packing (weight + volume constraints) with greedy
seeding and local search heuristics to combine multiple compatible freight loads
onto a single truck. Sequences multi-stop pickups and deliveries using OSRM
with graceful haversine fallbacks.
"""

from __future__ import annotations

import logging
import math
import os
import urllib.parse
import urllib.request
import json
from typing import List, Dict, Any, Optional, Tuple

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Model #16: Cargo & Payload Optimiser"])

# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------

class LoadItem(BaseModel):
    load_id: str = Field(..., description="Unique load identifier (e.g. L1)")
    weight_kg: float = Field(..., ge=0, description="Cargo weight in kilograms")
    volume_m3: float = Field(..., ge=0, description="Cargo volume in cubic metres")
    origin: List[float] = Field(..., min_length=2, max_length=2, description="[lat, lng] of pickup")
    destination: List[float] = Field(..., min_length=2, max_length=2, description="[lat, lng] of dropoff")
    freight_amount: float = Field(..., ge=0, description="Offered freight payout in INR")


class LoadOptimiserInput(BaseModel):
    truck_payload_kg: float = Field(..., gt=0, description="Maximum truck weight capacity in kg")
    truck_volume_m3: float = Field(..., gt=0, description="Maximum truck volumetric capacity in m3")
    available_loads: List[LoadItem] = Field(..., description="Pool of candidate loads")
    driver_location: List[float] = Field(..., min_length=2, max_length=2, description="Driver current [lat, lng]")


class RouteStop(BaseModel):
    type: str = Field(..., description="'start', 'pickup', or 'destination'")
    load_id: Optional[str] = Field(None, description="Associated load ID for pickup or dropoff")
    location: List[float] = Field(..., description="[lat, lng] coordinates")
    description: str = Field(..., description="Human-readable stop description")


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


# ---------------------------------------------------------------------------
# Distance & Geometry Utilities
# ---------------------------------------------------------------------------

EARTH_RADIUS_KM = 6371.0
CIRCUITY_FACTOR = 1.25  # Highway circuity factor for Indian roads over Haversine
AVG_TRUCK_SPEED_KMH = 45.0  # Typical commercial truck average speed in India


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate great-circle distance between two points in km."""
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2.0) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lon / 2.0) ** 2
    )
    return 2.0 * EARTH_RADIUS_KM * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))


_osrm_status: Optional[bool] = None


def query_osrm_distance(points: List[Tuple[float, float]]) -> Tuple[float, float]:
    """Query OSRM for driving distance (km) and duration (hours) across a sequence of points.

    Falls back to circuity-adjusted Haversine if OSRM is unreachable.
    """
    global _osrm_status
    if len(points) < 2:
        return 0.0, 0.0

    osrm_url = os.environ.get("OSRM_BASE_URL", "http://localhost:5002").rstrip("/")

    # Only attempt OSRM query if not previously marked unreachable
    if _osrm_status is not False:
        coords_str = ";".join(f"{lon:.6f},{lat:.6f}" for lat, lon in points)
        url = f"{osrm_url}/route/v1/driving/{coords_str}?overview=false&steps=false"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Truxify-ML-Engine"})
            with urllib.request.urlopen(req, timeout=0.5) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    if data.get("code") == "Ok" and "routes" in data and len(data["routes"]) > 0:
                        _osrm_status = True
                        distance_m = data["routes"][0].get("distance", 0.0)
                        duration_s = data["routes"][0].get("duration", 0.0)
                        return round(distance_m / 1000.0, 1), round(duration_s / 3600.0, 2)
        except Exception:
            _osrm_status = False

    total_dist_km = 0.0
    for i in range(len(points) - 1):
        p1 = points[i]
        p2 = points[i + 1]
        dist = haversine_km(p1[0], p1[1], p2[0], p2[1]) * CIRCUITY_FACTOR
        total_dist_km += dist

    total_dist_km = max(round(total_dist_km, 1), 5.0)
    duration_hours = round(total_dist_km / AVG_TRUCK_SPEED_KMH, 2)
    return total_dist_km, duration_hours


# ---------------------------------------------------------------------------
# Stop Sequencing with Precedence (Pickups before Dropoffs)
# ---------------------------------------------------------------------------

def sequence_stops(
    driver_loc: Tuple[float, float],
    loads: List[LoadItem]
) -> Tuple[List[RouteStop], List[Tuple[float, float]]]:
    """Sequence pickups and dropoffs greedily by nearest feasible stop,

    ensuring that every load's origin is visited prior to its destination.
    """
    stops: List[RouteStop] = [
        RouteStop(
            type="start",
            load_id=None,
            location=[driver_loc[0], driver_loc[1]],
            description="Driver Start Location",
        )
    ]
    point_coords: List[Tuple[float, float]] = [driver_loc]

    picked_up = set()
    delivered = set()
    current_pos = driver_loc

    # Build candidates
    # Each stop: (type, load_id, (lat, lng), desc)
    total_stops_needed = len(loads) * 2

    while len(delivered) < len(loads):
        candidates = []
        for l in loads:
            if l.load_id not in picked_up:
                candidates.append((
                    "pickup",
                    l.load_id,
                    (l.origin[0], l.origin[1]),
                    f"Pickup {l.load_id} ({l.weight_kg}kg, {l.volume_m3}m³)",
                ))
            elif l.load_id not in delivered:
                candidates.append((
                    "destination",
                    l.load_id,
                    (l.destination[0], l.destination[1]),
                    f"Deliver {l.load_id} (Collect ₹{int(l.freight_amount):,})",
                ))

        if not candidates:
            break

        # Pick nearest candidate from current_pos
        best_cand = None
        best_dist = float("inf")
        for cand in candidates:
            c_loc = cand[2]
            d = haversine_km(current_pos[0], current_pos[1], c_loc[0], c_loc[1])
            if d < best_dist:
                best_dist = d
                best_cand = cand

        stop_type, l_id, loc, desc = best_cand
        stops.append(RouteStop(
            type=stop_type,
            load_id=l_id,
            location=[loc[0], loc[1]],
            description=desc,
        ))
        point_coords.append(loc)
        current_pos = loc

        if stop_type == "pickup":
            picked_up.add(l_id)
        else:
            delivered.add(l_id)

    return stops, point_coords


# ---------------------------------------------------------------------------
# Multi-Dimensional Bin Packing & Local Search Engine
# ---------------------------------------------------------------------------

def compute_combination_details(
    candidate_loads: List[LoadItem],
    truck_weight: float,
    truck_volume: float,
    driver_loc: Tuple[float, float],
    combo_index: int,
) -> LoadCombination:
    """Evaluate and build a complete LoadCombination object for a feasible set of loads."""
    total_w = sum(l.weight_kg for l in candidate_loads)
    total_v = sum(l.volume_m3 for l in candidate_loads)
    total_rev = sum(l.freight_amount for l in candidate_loads)

    w_fill = round((total_w / truck_weight) * 100.0, 1)
    v_fill = round((total_v / truck_volume) * 100.0, 1)
    payload_fill = max(w_fill, v_fill)

    # Route sequencing
    route_stops, points = sequence_stops(driver_loc, candidate_loads)
    dist_km, dur_h = query_osrm_distance(points)

    # Revenue per km efficiency
    earnings_per_km = total_rev / max(dist_km, 1.0)

    # Composite ranking score:
    # 50% normalized earnings, 30% payload fill, 20% distance efficiency
    score = round(
        (0.5 * (total_rev / 10000.0))
        + (0.3 * (payload_fill / 100.0))
        + (0.2 * min(earnings_per_km / 100.0, 2.0)),
        3,
    )

    # Recommendation badge
    if len(candidate_loads) > 1 and payload_fill >= 80.0:
        reason = f"High Capacity Multi-Load ({len(candidate_loads)} shipments): {payload_fill}% fill, ₹{int(total_rev):,} earnings"
    elif len(candidate_loads) > 1:
        reason = f"Multi-Drop Consolidation: {len(candidate_loads)} loads, ₹{earnings_per_km:.0f}/km efficiency"
    else:
        reason = f"Single Direct Load: {payload_fill}% truck capacity utilization"

    return LoadCombination(
        combination_id=f"COMBO-{combo_index}",
        load_ids=[l.load_id for l in candidate_loads],
        loads=candidate_loads,
        total_weight_kg=round(total_w, 1),
        total_volume_m3=round(total_v, 1),
        weight_fill_percent=w_fill,
        volume_fill_percent=v_fill,
        payload_fill_percent=payload_fill,
        total_freight_amount=round(total_rev, 2),
        estimated_distance_km=dist_km,
        estimated_duration_hours=dur_h,
        route_sequence=route_stops,
        score=score,
        recommendation_reason=reason,
    )


def solve_load_optimisation(
    truck_payload_kg: float,
    truck_volume_m3: float,
    available_loads: List[LoadItem],
    driver_location: Tuple[float, float],
    top_k: int = 5,
) -> List[LoadCombination]:
    """Execute multi-dimensional bin packing with greedy seeds + local search."""
    # 1. Filter out loads that physically cannot fit individually
    valid_loads = [
        l for l in available_loads
        if l.weight_kg <= truck_payload_kg and l.volume_m3 <= truck_volume_m3
    ]

    if not valid_loads:
        return []

    # 2. Compute value density for each load
    # Density metric = freight / (0.5 * (w/W) + 0.5 * (v/V))
    def get_density(item: LoadItem) -> float:
        norm_w = item.weight_kg / truck_payload_kg
        norm_v = item.volume_m3 / truck_volume_m3
        consumption = max(0.5 * norm_w + 0.5 * norm_v, 0.001)
        return item.freight_amount / consumption

    # Store discovered sets of load_ids to prevent duplicates
    discovered_combos: Dict[frozenset[str], List[LoadItem]] = {}

    def try_register_combo(candidate: List[LoadItem]):
        if not candidate:
            return
        tot_w = sum(x.weight_kg for x in candidate)
        tot_v = sum(x.volume_m3 for x in candidate)
        if tot_w <= truck_payload_kg and tot_v <= truck_volume_m3:
            key = frozenset(x.load_id for x in candidate)
            if key not in discovered_combos:
                discovered_combos[key] = candidate

    # 3. Greedy Heuristic Seeds
    # Seed A: Density-first greedy
    density_sorted = sorted(valid_loads, key=get_density, reverse=True)
    combo_a: List[LoadItem] = []
    w_acc = 0.0
    v_acc = 0.0
    for l in density_sorted:
        if w_acc + l.weight_kg <= truck_payload_kg and v_acc + l.volume_m3 <= truck_volume_m3:
            combo_a.append(l)
            w_acc += l.weight_kg
            v_acc += l.volume_m3
    try_register_combo(combo_a)

    # Seed B: Revenue-first greedy
    revenue_sorted = sorted(valid_loads, key=lambda x: x.freight_amount, reverse=True)
    combo_b: List[LoadItem] = []
    w_acc = 0.0
    v_acc = 0.0
    for l in revenue_sorted:
        if w_acc + l.weight_kg <= truck_payload_kg and v_acc + l.volume_m3 <= truck_volume_m3:
            combo_b.append(l)
            w_acc += l.weight_kg
            v_acc += l.volume_m3
    try_register_combo(combo_b)

    # Seed C: Proximity-first greedy (nearest pickup to driver location)
    def dist_to_driver(l: LoadItem) -> float:
        return haversine_km(driver_location[0], driver_location[1], l.origin[0], l.origin[1])

    proximity_sorted = sorted(valid_loads, key=dist_to_driver)
    combo_c: List[LoadItem] = []
    w_acc = 0.0
    v_acc = 0.0
    for l in proximity_sorted:
        if w_acc + l.weight_kg <= truck_payload_kg and v_acc + l.volume_m3 <= truck_volume_m3:
            combo_c.append(l)
            w_acc += l.weight_kg
            v_acc += l.volume_m3
    try_register_combo(combo_c)

    # Seed D: Single largest loads as single-load baselines
    for single in revenue_sorted[:3]:
        try_register_combo([single])

    # 4. Local Search (1-opt & 2-opt swaps + greedy filling)
    base_combos = list(discovered_combos.values())
    for combo in base_combos:
        current_set = set(x.load_id for x in combo)
        unselected = [x for x in valid_loads if x.load_id not in current_set]

        # Greedy fill: try adding any unselected loads
        extended = list(combo)
        for cand in unselected:
            tot_w = sum(x.weight_kg for x in extended) + cand.weight_kg
            tot_v = sum(x.volume_m3 for x in extended) + cand.volume_m3
            if tot_w <= truck_payload_kg and tot_v <= truck_volume_m3:
                extended.append(cand)
        try_register_combo(extended)

        # 1-opt swap: replace one item with a better unselected item
        for i, in_item in enumerate(combo):
            for cand in unselected:
                swap_candidate = list(combo)
                swap_candidate[i] = cand
                try_register_combo(swap_candidate)

    # 5. Evaluate and rank all discovered combinations
    evaluated: List[LoadCombination] = []
    for idx, loads_comb in enumerate(discovered_combos.values(), start=1):
        res = compute_combination_details(
            candidate_loads=loads_comb,
            truck_weight=truck_payload_kg,
            truck_volume=truck_volume_m3,
            driver_loc=driver_location,
            combo_index=idx,
        )
        evaluated.append(res)

    # 6. Rank combinations by score and revenue
    evaluated.sort(key=lambda c: (c.score, c.total_freight_amount, c.payload_fill_percent), reverse=True)

    # Re-index combination IDs in clean ranked order (COMBO-1, COMBO-2, ...)
    ranked: List[LoadCombination] = []
    for rank_idx, combo in enumerate(evaluated[:top_k], start=1):
        combo.combination_id = f"COMBO-{rank_idx}"
        ranked.append(combo)

    return ranked


# ---------------------------------------------------------------------------
# FastAPI Router Endpoints
# ---------------------------------------------------------------------------

@router.post("/api/ml/load-optimiser", response_model=LoadOptimiserOutput)
@router.post("/load-optimiser", response_model=LoadOptimiserOutput)
async def optimise_loads_endpoint(payload: LoadOptimiserInput) -> LoadOptimiserOutput:
    """Optimise multi-load assignments within weight and volume constraints.

    Generates ranked combinations maximizing total revenue and vehicle capacity
    utilization while ordering multi-stop pickup and dropoff waypoints.
    """
    try:
        driver_loc = (payload.driver_location[0], payload.driver_location[1])
        combinations = solve_load_optimisation(
            truck_payload_kg=payload.truck_payload_kg,
            truck_volume_m3=payload.truck_volume_m3,
            available_loads=payload.available_loads,
            driver_location=driver_loc,
            top_k=5,
        )

        return LoadOptimiserOutput(
            success=True,
            model_id=16,
            model_name="Cargo & Payload Multi-Load Optimiser",
            truck_payload_kg=payload.truck_payload_kg,
            truck_volume_m3=payload.truck_volume_m3,
            driver_location=payload.driver_location,
            total_available_loads=len(payload.available_loads),
            feasible_combinations_count=len(combinations),
            combinations=combinations,
        )
    except Exception as e:
        logger.error("Load optimiser failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Load optimisation error: {str(e)}")
