"""Unit tests for backend/ml/app/models/bilateral_matcher.py.

Run with: python3 -m pytest tests/test_bilateral_matcher_algo.py -v --no-header
"""
import math

from app.models.bilateral_matcher import (
    _haversine,
    _distance_cost,
    match_bilateral,
)


def make_load(**overrides):
    load = {
        "origin_lat": 12.0, "origin_lng": 77.0,
        "dest_lat": 12.1, "dest_lng": 77.1,
        "weight_kg": 500, "length_m": 2, "width_m": 1, "height_m": 1,
        "deadline_hours": 24,
    }
    load.update(overrides)
    return load


def make_driver(**overrides):
    driver = {
        "current_lat": 12.05, "current_lng": 77.05,
        "max_weight_kg": 5000, "max_length_m": 10, "max_width_m": 3, "max_height_m": 3,
        "preferred_dest_lat": 12.1, "preferred_dest_lng": 77.1,
        "rating": 4.5,
    }
    driver.update(overrides)
    return driver


class TestHaversine:
    """Tests for the great-circle distance helper."""

    def test_same_point_is_zero(self):
        assert _haversine(12.0, 77.0, 12.0, 77.0) == 0.0

    def test_known_distance(self):
        dist = _haversine(28.61, 77.21, 19.08, 72.88)
        assert 1000 < dist < 1300

    def test_distance_cost_uses_haversine(self):
        """_distance_cost must equal the haversine distance."""
        driver = make_driver()
        load = make_load(origin_lat=12.0, origin_lng=77.0)
        expected = _haversine(12.05, 77.05, 12.0, 77.0)
        assert math.isclose(_distance_cost(driver, load), expected, rel_tol=1e-9)


class TestMatchBilateral:
    """Tests for the Hungarian-algorithm matching."""

    def test_both_empty(self):
        assert match_bilateral([], []) == {
            "assignments": [], "unmatched_loads": [], "unmatched_drivers": [],
        }

    def test_no_drivers(self):
        loads = [make_load()]
        result = match_bilateral(loads, [])
        assert result["assignments"] == []
        assert result["unmatched_loads"] == [0]
        assert result["unmatched_drivers"] == []

    def test_no_loads(self):
        drivers = [make_driver()]
        result = match_bilateral([], drivers)
        assert result["assignments"] == []
        assert result["unmatched_loads"] == []
        assert result["unmatched_drivers"] == [0]

    def test_single_match(self):
        """A compatible driver/load pair must be assigned."""
        loads = [make_load()]
        drivers = [make_driver()]
        result = match_bilateral(loads, drivers)
        assert len(result["assignments"]) == 1
        assignment = result["assignments"][0]
        assert assignment["load_index"] == 0
        assert assignment["driver_index"] == 0
        assert 0.0 <= assignment["match_score"] <= 1.0
        assert result["unmatched_loads"] == []
        assert result["unmatched_drivers"] == []

    def test_infeasible_driver_goes_unmatched(self):
        """A driver with insufficient capacity must not be assigned."""
        loads = [make_load(weight_kg=100000)]
        drivers = [make_driver(max_weight_kg=1000)]
        result = match_bilateral(loads, drivers)
        assert result["assignments"] == []
        assert result["unmatched_loads"] == [0]
        assert result["unmatched_drivers"] == [0]

    def test_prefers_closer_driver(self):
        """Two drivers: the closer one must get the assignment."""
        loads = [make_load(origin_lat=12.0, origin_lng=77.0)]
        drivers = [
            make_driver(current_lat=12.0, current_lng=77.0, rating=4.0),   # 0 km away
            make_driver(current_lat=12.9, current_lng=77.9, rating=5.0),   # far away
        ]
        result = match_bilateral(loads, drivers)
        assert len(result["assignments"]) == 1
        assert result["assignments"][0]["driver_index"] == 0
