"""
Unit tests for backend/ml/app/models/deadhead_eliminator.py

Run with: python3 -m pytest tests/test_deadhead_eliminator.py -v --no-header
"""
import math
from datetime import datetime, timezone, timedelta
from app.models.deadhead_eliminator import (
    _haversine,
    _to_naive,
    find_return_loads,
    MAX_DETOUR_FRACTION,
)


class TestHaversine:
    """Tests for the haversine distance calculation."""

    def test_same_point_returns_zero(self):
        """Identical coordinates should give zero distance."""
        assert _haversine(0, 0, 0, 0) == 0.0

    def test_known_distance_delhi_to_mumbai(self):
        """Delhi (28.6139, 77.2090) to Mumbai (19.0760, 72.8777) is approx 1152 km."""
        dist = _haversine(28.6139, 77.2090, 19.0760, 72.8777)
        assert 1100 < dist < 1200

    def test_short_distance(self):
        """1 degree latitude ~= 111 km."""
        dist = _haversine(0, 0, 1, 0)
        assert 110 < dist < 112

    def test_antipodal_points(self):
        """Antipodal points are roughly 20,000 km apart."""
        dist = _haversine(0, 0, 0, 180)
        assert 20000 - 100 < dist < 20000 + 100


class TestToNaive:
    """Tests for _to_naive datetime normalisation."""

    def test_strips_timezone_info(self):
        """Aware datetime should have tzinfo stripped."""
        aware = datetime(2026, 8, 7, 10, 30, tzinfo=timezone.utc)
        result = _to_naive(aware)
        assert result.tzinfo is None
        assert result == datetime(2026, 8, 7, 10, 30)

    def test_preserves_naive_datetime(self):
        """Already-naive datetime should be returned unchanged."""
        naive = datetime(2026, 8, 7, 10, 30)
        assert _to_naive(naive) == naive


class TestFindReturnLoads:
    """Tests for find_return_loads logic."""

    def test_empty_loads_returns_empty_recommendations(self):
        result = find_return_loads(
            driver_destination={"lat": 12.97, "lng": 77.62},
            truck_specs={"max_weight_kg": 10000},
            arrival_time="2026-08-07T10:00:00",
            available_loads=[],
        )
        assert result["recommendations"] == []

    def test_oversized_load_is_filtered(self):
        """Load exceeding truck weight should be excluded."""
        result = find_return_loads(
            driver_destination={"lat": 12.97, "lng": 77.62},
            truck_specs={"max_weight_kg": 5000, "max_length_m": 6, "max_width_m": 2, "max_height_m": 2.5},
            arrival_time="2026-08-10T10:00:00",
            available_loads=[{
                "load_id": "L001",
                "origin_lat": 12.98,
                "origin_lng": 77.63,
                "dest_lat": 13.0,
                "dest_lng": 77.7,
                "weight_kg": 10000,  # exceeds 5000 kg limit
                "length_m": 5,
                "width_m": 2,
                "height_m": 2,
                "pickup_deadline": "2026-08-10T12:00:00",
                "payment_inr": 5000,
            }],
        )
        assert result["recommendations"] == []

    def test_valid_load_is_recommended(self):
        """Load within truck specs and time window should be recommended."""
        result = find_return_loads(
            driver_destination={"lat": 12.97, "lng": 77.62},
            truck_specs={"max_weight_kg": 10000, "max_length_m": 10, "max_width_m": 2.5, "max_height_m": 3},
            arrival_time="2026-08-10T08:00:00",
            available_loads=[{
                "load_id": "L001",
                "origin_lat": 12.98,
                "origin_lng": 77.63,
                "dest_lat": 13.1,
                "dest_lng": 77.8,
                "weight_kg": 5000,
                "length_m": 5,
                "width_m": 2,
                "height_m": 2,
                "pickup_deadline": "2026-08-10T14:00:00",  # deadline allows 6 hours, trip is ~30 min
                "payment_inr": 3000,
            }],
        )
        assert len(result["recommendations"]) == 1
        assert result["recommendations"][0]["load_id"] == "L001"

    def test_load_past_deadline_is_filtered(self):
        """Load whose pickup deadline is before estimated arrival should be excluded."""
        result = find_return_loads(
            driver_destination={"lat": 12.97, "lng": 77.62},
            truck_specs={"max_weight_kg": 10000, "max_length_m": 10, "max_width_m": 2.5, "max_height_m": 3},
            arrival_time="2026-08-10T12:00:00",
            available_loads=[{
                "load_id": "L001",
                "origin_lat": 12.98,
                "origin_lng": 77.63,
                "dest_lat": 13.1,
                "dest_lng": 77.8,
                "weight_kg": 5000,
                "length_m": 5,
                "width_m": 2,
                "height_m": 2,
                "pickup_deadline": "2026-08-10T10:00:00",  # deadline already passed
                "payment_inr": 3000,
            }],
        )
        assert result["recommendations"] == []
