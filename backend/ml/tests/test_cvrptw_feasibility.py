"""Independent exhaustive feasibility/replay of the actual standalone solver."""

import copy
import importlib.util
import itertools
import json
import math
import random
from fractions import Fraction
from pathlib import Path

import pytest

# Load the real source without services.__init__'s unrelated eager traffic stack.
spec = importlib.util.spec_from_file_location(
    "native_cvrptw", Path(__file__).parents[1] / "services/cvrptw_solver.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
CvrptwSolver = module.CvrptwSolver


def job(
    identity, weight=1, pickup=0.0, delivery=0.01, pickup_end=1440, delivery_end=1440
):
    return {
        "id": identity,
        "weight_kg": weight,
        "pickup": {"lat": 0.0, "lng": pickup, "time_window_end_min": pickup_end},
        "delivery": {"lat": 0.0, "lng": delivery, "time_window_end_min": delivery_end},
    }


def independent_distance(a, b):
    # On the equator with these local longitudes, arc length is exactly the
    # absolute longitude difference times radians and the documented radius.
    return abs(a - b) * math.pi / 180 * 6371


def replay(jobs, cap, order, service=0, speed=45, start=0):
    picked = set()
    delivered = set()
    load = Fraction(0)
    clock = Fraction.from_float(float(start))
    lng = 0.0
    for index, kind in order:
        entry = jobs[index]
        weight = Fraction.from_float(float(entry["weight_kg"]))
        if kind == "pickup":
            if index in picked:
                return False
            picked.add(index)
            load += weight
        else:
            if index not in picked or index in delivered:
                return False
            delivered.add(index)
            load -= weight
        if load > Fraction.from_float(float(cap)) or load < 0:
            return False
        stop = entry[kind]
        travel = independent_distance(lng, stop["lng"]) / speed * 60
        clock += Fraction.from_float(travel)
        clock = max(
            clock, Fraction.from_float(float(stop.get("time_window_start_min", 0)))
        )
        if clock > Fraction.from_float(float(stop.get("time_window_end_min", 1440))):
            return False
        clock += Fraction.from_float(float(service))
        lng = stop["lng"]
    return len(delivered) == len(jobs) and load == 0


def oracle(jobs, cap, service=0):
    stops = [
        (index, kind) for index in range(len(jobs)) for kind in ["pickup", "delivery"]
    ]
    return any(
        replay(jobs, cap, order, service) for order in itertools.permutations(stops)
    )


def verify(result, jobs, cap, service=0, start=0):
    assert result["success"] and len(result["itinerary"]) == 2 * len(jobs)
    by_id = {item["id"]: index for index, item in enumerate(jobs)}
    order = [
        (by_id[stop["consignment_id"]], stop["type"].lower())
        for stop in result["itinerary"]
    ]
    assert replay(jobs, cap, order, service, start=start)
    active = set()
    for sequence, stop in enumerate(result["itinerary"], 1):
        assert stop["sequence"] == sequence and stop["is_within_time_window"]
        active.add(stop["consignment_id"]) if stop[
            "type"
        ] == "PICKUP" else active.remove(stop["consignment_id"])
        exact = sum(
            (
                Fraction.from_float(float(item["weight_kg"]))
                for item in jobs
                if item["id"] in active
            ),
            Fraction(0),
        )
        assert (
            stop["vehicle_load_kg"] >= float(exact) and stop["vehicle_load_kg"] <= cap
        )
        window = jobs[by_id[stop["consignment_id"]]][stop["type"].lower()]
        assert (
            window.get("time_window_start_min", 0)
            <= stop["start_service_time_min"]
            <= window.get("time_window_end_min", 1440)
        )
    json.dumps(result, allow_nan=False)


def test_recovers_nearest_first_capacity_dead_end():
    jobs = [
        job("nearest", pickup=0, delivery=0.02),
        job("urgent", pickup=0.01, delivery=0.01, pickup_end=3),
    ]
    result = CvrptwSolver(service_time_mins=0).solve({"lat": 0, "lng": 0}, jobs, 1)
    verify(result, jobs, 1)
    assert result["itinerary"][0]["consignment_id"] == "urgent"
    assert result["search_states"] > 5


def test_independent_exhaustive_seeded_small_problems():
    rng = random.Random(839)
    for _ in range(80):
        jobs = [
            job(
                str(i),
                rng.choice([0, 1, 2]),
                rng.choice([0, 0.01, 0.02, 0.03]),
                rng.choice([0, 0.01, 0.02, 0.03]),
                rng.choice([2, 5, 12]),
                rng.choice([4, 8, 16]),
            )
            for i in range(2)
        ]
        cap = rng.choice([1, 2, 3])
        service = rng.choice([0, 1])
        result = CvrptwSolver(service_time_mins=service).solve(
            {"lat": 0, "lng": 0}, jobs, cap
        )
        assert result["success"] == oracle(jobs, cap, service)
        if result["success"]:
            verify(result, jobs, cap, service)
        else:
            assert result["reason"] == "infeasible" and result["itinerary"] == []


@pytest.mark.parametrize(
    "jobs,cap",
    [([job("heavy", 11)], 10), ([job("late", delivery=1, delivery_end=0)], 10)],
)
def test_impossible_input_never_forces_invalid_success(jobs, cap):
    result = CvrptwSolver(service_time_mins=0).solve({"lat": 0, "lng": 0}, jobs, cap)
    assert not result["success"] and result["reason"] == "infeasible"
    assert result["itinerary"] == [] and result["total_stops"] == 0


def test_search_budget_is_uncertainty_not_infeasibility():
    jobs = [job("one", delivery=0)]
    for budget in [1, 2]:
        result = CvrptwSolver(service_time_mins=0, max_search_states=budget).solve(
            {}, jobs, 1
        )
        assert result["reason"] == "search_limit" and not result["success"]
        assert result["search_states"] == budget and result["itinerary"] == []
    verify(
        CvrptwSolver(service_time_mins=0, max_search_states=3).solve({}, jobs, 1),
        jobs,
        1,
    )


def test_waiting_service_and_elapsed_duration_preserve_input():
    jobs = [job("waiting", delivery=0)]
    jobs[0]["pickup"].update(time_window_start_min=10, time_window_end_min=10)
    jobs[0]["delivery"].update(time_window_start_min=20, time_window_end_min=20)
    before = copy.deepcopy(jobs)
    result = CvrptwSolver(service_time_mins=2).solve(
        {"lat": 0, "lng": 0, "start_time_min": 5}, jobs, 1
    )
    verify(result, jobs, 1, service=2, start=5)
    assert result["total_duration_mins"] == 17
    assert [s["start_service_time_min"] for s in result["itinerary"]] == [10, 20]
    assert jobs == before


def test_empty_problem_and_complete_zero_mass_problem():
    result = CvrptwSolver().solve({}, [], 0)
    assert result["success"] and result["itinerary"] == result["stops"] == []
    jobs = [job(str(i), 0, delivery=0) for i in range(32)]
    result = CvrptwSolver(service_time_mins=0).solve({}, jobs, 0)
    verify(result, jobs, 0)
    assert result["consignments_count"] == 32


def test_exact_active_load_does_not_lose_tiny_payload_beside_large_one():
    jobs = [job("large", 1e16, delivery=0.02), job("tiny", 1, delivery=0.02)]
    result = CvrptwSolver(service_time_mins=0).solve({}, jobs, 1e16)
    verify(result, jobs, 1e16)
    assert result["itinerary"][1]["type"] == "DELIVERY"


def test_subprecision_clock_increment_cannot_meet_expired_deadline():
    jobs = [job("late", delivery=0.001, delivery_end=1e16)]
    jobs[0]["pickup"]["time_window_end_min"] = 1e16
    result = CvrptwSolver(service_time_mins=0).solve({"start_time_min": 1e16}, jobs, 1)
    assert not result["success"] and result["reason"] == "infeasible"


@pytest.mark.parametrize(
    "field,value",
    [
        ("weight_kg", -1),
        ("weight_kg", math.nan),
        ("weight_kg", math.inf),
        ("weight_kg", True),
        ("id", ""),
        ("id", None),
    ],
)
def test_invalid_consignment_admission(field, value):
    jobs = [job("one")]
    jobs[0][field] = value
    with pytest.raises((ValueError, TypeError)):
        CvrptwSolver().solve({}, jobs)


@pytest.mark.parametrize(
    "field,value",
    [
        ("lat", 91),
        ("lng", 181),
        ("lat", math.nan),
        ("lng", "0"),
        ("time_window_start_min", -1),
        ("time_window_end_min", None),
        ("time_window_start_min", 1500),
    ],
)
def test_invalid_location_admission(field, value):
    jobs = [job("one")]
    jobs[0]["pickup"][field] = value
    with pytest.raises((ValueError, TypeError)):
        CvrptwSolver().solve({}, jobs)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"avg_speed_kmh": 0},
        {"avg_speed_kmh": math.inf},
        {"service_time_mins": -1},
        {"max_search_states": 0},
        {"max_search_states": True},
        {"max_search_states": 100001},
    ],
)
def test_invalid_configuration(kwargs):
    with pytest.raises((ValueError, TypeError)):
        CvrptwSolver(**kwargs)


def test_duplicate_ids_invalid_depot_capacity_and_public_config_revalidation():
    solver = CvrptwSolver()
    with pytest.raises(ValueError):
        solver.solve({}, [job("same"), job("same")])
    with pytest.raises(ValueError):
        solver.solve({"lat": math.inf}, [])
    with pytest.raises(ValueError):
        solver.solve({}, [], -1)
    solver.avg_speed_kmh = 0
    with pytest.raises(ValueError):
        solver.solve({}, [])


def test_antipodal_distance_and_numeric_limit_are_finite_explicit():
    assert module.haversine_distance_km(0, 0, 0, 180) == pytest.approx(math.pi * 6371)
    jobs = [job("numeric", delivery=0)]
    for kind in ["pickup", "delivery"]:
        jobs[0][kind]["time_window_start_min"] = 1e308
        jobs[0][kind]["time_window_end_min"] = 1e308
    result = CvrptwSolver(service_time_mins=1e308).solve({}, jobs, 1)
    assert not result["success"] and result["reason"] == "numeric_limit"
    json.dumps(result, allow_nan=False)
