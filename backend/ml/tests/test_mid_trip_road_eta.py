from datetime import datetime, timedelta, timezone

from app.models import mid_trip_reoptimiser


CAPACITY = {
    "weight_kg": 10000,
    "length_m": 10,
    "width_m": 3,
    "height_m": 3,
}


def _load(load_id="L1", deadline=None):
    return {
        "load_id": load_id,
        "pickup_lat": 0.0,
        "pickup_lng": 1.0,
        "dropoff_lat": 0.0,
        "dropoff_lng": 2.0,
        "weight_kg": 100,
        "length_m": 1,
        "width_m": 1,
        "height_m": 1,
        "payment_inr": 5000,
        "pickup_deadline": deadline or (datetime.now(timezone.utc) + timedelta(hours=6)).isoformat(),
    }


def _matrix(size):
    return [[0.0 for _ in range(size)] for _ in range(size)]


def test_detour_minutes_uses_road_duration(monkeypatch):
    distance = _matrix(3)
    duration = _matrix(3)
    distance[0][1] = 10.0
    distance[1][2] = 10.0
    duration[0][1] = 35.0
    duration[1][2] = 85.0

    monkeypatch.setattr(
        mid_trip_reoptimiser,
        "get_route_matrix_with_duration",
        lambda locations: (distance, duration),
    )

    result = mid_trip_reoptimiser.find_mid_trip_loads(
        {"lat": 0.0, "lng": 0.0},
        [],
        CAPACITY,
        [_load()],
    )

    recommendation = result["recommendations"][0]
    assert recommendation["detour_km"] == 20.0
    assert recommendation["detour_minutes"] == 120.0


def test_slow_road_route_has_lower_priority_than_fast_route(monkeypatch):
    distance = _matrix(5)
    duration = _matrix(5)

    # Both candidates have identical road distances.
    distance[0][1] = distance[1][3] = 10.0
    distance[0][2] = distance[2][4] = 10.0

    # Candidate 0 is fast; candidate 1 is materially slower.
    duration[0][1] = duration[1][3] = 10.0
    duration[0][2] = duration[2][4] = 50.0

    monkeypatch.setattr(
        mid_trip_reoptimiser,
        "get_route_matrix_with_duration",
        lambda locations: (distance, duration),
    )

    deadline = (datetime.now(timezone.utc) + timedelta(minutes=120)).isoformat()
    loads = [_load("fast", deadline), _load("slow", deadline)]

    result = mid_trip_reoptimiser.find_mid_trip_loads(
        {"lat": 0.0, "lng": 0.0},
        [],
        CAPACITY,
        loads,
    )

    assert [item["load_id"] for item in result["recommendations"]] == ["fast", "slow"]
    assert result["recommendations"][0]["priority_score"] > result["recommendations"][1]["priority_score"]


def test_road_eta_can_reject_a_deadline_that_fixed_speed_would_accept(monkeypatch):
    distance = _matrix(3)
    duration = _matrix(3)
    distance[0][1] = 70.0
    distance[1][2] = 1.0
    duration[0][1] = 180.0
    duration[1][2] = 5.0

    monkeypatch.setattr(
        mid_trip_reoptimiser,
        "get_route_matrix_with_duration",
        lambda locations: (distance, duration),
    )

    deadline = (datetime.now(timezone.utc) + timedelta(minutes=150)).isoformat()
    result = mid_trip_reoptimiser.find_mid_trip_loads(
        {"lat": 0.0, "lng": 0.0},
        [],
        CAPACITY,
        [_load(deadline=deadline)],
    )

    assert result["recommendations"] == []
