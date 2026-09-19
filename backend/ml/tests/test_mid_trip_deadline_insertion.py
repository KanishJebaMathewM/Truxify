from datetime import datetime, timedelta, timezone

from app.models import mid_trip_reoptimiser


CAPACITY = {
    "weight_kg": 10000,
    "length_m": 10,
    "width_m": 3,
    "height_m": 3,
}


def _matrix(size):
    return [[0.0 for _ in range(size)] for _ in range(size)]


def test_longer_deadline_feasible_insertion_is_selected(monkeypatch):
    distance = _matrix(4)
    duration = _matrix(4)

    # Base route is 0 -> 1.
    distance[0][1] = 10.0
    duration[0][1] = 10.0

    # Inserting pickup 2 before waypoint 1 is the shortest detour,
    # but reaching pickup 2 takes two hours on the road.
    distance[0][2] = 2.0
    distance[2][1] = 1.0
    distance[2][3] = 10.0
    distance[3][1] = 1.0
    duration[0][2] = 120.0
    duration[2][1] = 1.0
    duration[2][3] = 1.0
    duration[3][1] = 1.0

    # Inserting pickup 2 after waypoint 1 has a longer detour, but reaches
    # the pickup quickly enough to satisfy the deadline.
    distance[1][2] = 20.0
    duration[1][2] = 10.0
    distance[2][3] = 10.0
    duration[2][3] = 10.0

    monkeypatch.setattr(
        mid_trip_reoptimiser,
        "get_route_matrix_with_duration",
        lambda locations: (distance, duration),
    )

    deadline = (datetime.now(timezone.utc) + timedelta(minutes=60)).isoformat()
    load = {
        "load_id": "deadline-alternative",
        "pickup_lat": 0.0,
        "pickup_lng": 1.0,
        "dropoff_lat": 0.0,
        "dropoff_lng": 2.0,
        "weight_kg": 500,
        "length_m": 2,
        "width_m": 1,
        "height_m": 1,
        "payment_inr": 5000,
        "pickup_deadline": deadline,
    }

    result = mid_trip_reoptimiser.find_mid_trip_loads(
        {"lat": 0.0, "lng": 0.0},
        [{"lat": 0.0, "lng": 0.5}],
        CAPACITY,
        [load],
    )

    assert len(result["recommendations"]) == 1
    recommendation = result["recommendations"][0]
    assert recommendation["load_id"] == "deadline-alternative"
    assert recommendation["detour_km"] == 30.0
