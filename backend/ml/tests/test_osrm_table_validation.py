"""Validate OSRM table responses before handing matrices to load scoring."""
import math
from datetime import datetime, timedelta, timezone

import pytest

from app.models.mid_trip_reoptimiser import find_mid_trip_loads
from utils import osrm_client

LOCATIONS = [(0.0, 0.0), (0.0, 1.0)]


def response(monkeypatch, payload):
    class Reply:
        def raise_for_status(self):
            pass

        def json(self):
            return payload

    monkeypatch.setattr(osrm_client.requests, "get", lambda *args, **kwargs: Reply())


def assert_fallback(monkeypatch, payload):
    response(monkeypatch, payload)
    distance, duration = osrm_client.get_route_matrix_with_duration(LOCATIONS)
    expected = math.pi / 180 * 6371.0
    assert len(distance) == len(duration) == 2
    for matrix in (distance, duration):
        assert all(len(row) == 2 for row in matrix)
        assert matrix[0][0] == matrix[1][1] == 0.0
    assert distance[0][1] == pytest.approx(expected)
    assert distance[1][0] == pytest.approx(expected)
    assert duration[0][1] == pytest.approx(expected / 40 * 60)


@pytest.mark.parametrize("field", ["distances", "durations"])
@pytest.mark.parametrize("matrix", [
    [], [[0]], [[0, 100], [100, 0], [100, 100]],
    [[0, 100, 200], [100, 0]], [0, [100, 0]],
])
def test_invalid_dimensions_use_existing_fallback(monkeypatch, field, matrix):
    payload = {"distances": [[0, 1000], [1000, 0]], "durations": [[0, 60], [60, 0]]}
    payload[field] = matrix
    assert_fallback(monkeypatch, payload)


@pytest.mark.parametrize("field", ["distances", "durations"])
@pytest.mark.parametrize("value", [-1, float("nan"), float("inf"), True])
def test_invalid_cells_use_existing_fallback(monkeypatch, field, value):
    payload = {"distances": [[0, 1000], [1000, 0]], "durations": [[0, 60], [60, 0]]}
    payload[field][0][1] = value
    assert_fallback(monkeypatch, payload)


@pytest.mark.parametrize("payload", [None, [], 7])
def test_non_object_table_response_uses_existing_fallback(monkeypatch, payload):
    assert_fallback(monkeypatch, payload)


def test_valid_table_units_numeric_strings_and_zero_are_preserved(monkeypatch):
    response(monkeypatch, {"distances": [[0, "1200"], [1500, 0]], "durations": [[0, "90"], [120, 0]]})
    distance, duration = osrm_client.get_route_matrix_with_duration(LOCATIONS)
    assert distance == [[0, 1.2], [1.5, 0]]
    assert duration == [[0, 1.5], [2, 0]]


def test_null_unreachable_cells_remain_infinite_without_geometric_substitution(monkeypatch):
    response(monkeypatch, {"distances": [[0, None], [1500, 0]], "durations": [[0, None], [120, 0]]})
    distance, duration = osrm_client.get_route_matrix_with_duration(LOCATIONS)
    assert math.isinf(distance[0][1]) and math.isinf(duration[0][1])
    assert distance[1][0] == 1.5 and duration[1][0] == 2


def test_short_provider_table_does_not_suppress_a_valid_mid_trip_load(monkeypatch):
    response(monkeypatch, {"distances": [[0]], "durations": [[0]]})
    result = find_mid_trip_loads(
        {"lat": 0, "lng": 0}, [],
        {"weight_kg": 1000, "length_m": 5, "width_m": 3, "height_m": 3},
        [{"load_id": "nearby", "pickup_lat": 0, "pickup_lng": 0.01,
          "dropoff_lat": 0, "dropoff_lng": 0.02, "weight_kg": 100,
          "length_m": 1, "width_m": 1, "height_m": 1, "payment_inr": 1000,
          "pickup_deadline": (datetime.now(timezone.utc) + timedelta(hours=4)).isoformat()}],
    )
    recommendation, = result["recommendations"]
    assert recommendation["load_id"] == "nearby"
    assert recommendation["detour_km"] == 2.22
    assert recommendation["detour_minutes"] == 3.34
