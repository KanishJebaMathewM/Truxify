"""Unit tests for backend/ml/app/models/mid_trip_reoptimiser.py.

Run with: python3 -m pytest tests/test_mid_trip_model.py -v --no-header
"""
import math
from datetime import datetime, timedelta, timezone

from app.models.mid_trip_reoptimiser import (
    _haversine,
    find_mid_trip_loads,
)


class TestHaversine:
    """Tests for the great-circle distance helper."""

    def test_same_point_is_zero(self):
        """Identical coordinates must give zero distance."""
        assert _haversine(12.97, 77.59, 12.97, 77.59) == 0.0

    def test_known_distance(self):
        """Delhi (28.61, 77.21) to Mumbai (19.08, 72.88) is roughly 1150 km."""
        dist = _haversine(28.61, 77.21, 19.08, 72.88)
        assert 1000 < dist < 1300

    def test_symmetry(self):
        """The distance must be symmetric."""
        a = (12.97, 77.59)
        b = (19.08, 72.88)
        assert math.isclose(_haversine(*a, *b), _haversine(*b, *a), rel_tol=1e-9)


class TestFindMidTripLoads:
    """Tests for the mid-trip load recommender."""

    def test_no_nearby_loads_returns_empty(self):
        """An empty nearby-loads list must yield no recommendations."""
        result = find_mid_trip_loads(
            {"lat": 12.0, "lng": 77.0},
            [],
            {"weight_kg": 1000, "length_m": 10, "width_m": 2, "height_m": 2},
            [],
        )
        assert result == {"recommendations": []}

    def test_load_over_capacity_is_filtered(self):
        """A load heavier than the remaining capacity must be skipped."""
        load = {
            "load_id": "L1",
            "pickup_lat": 12.1, "pickup_lng": 77.1,
            "dropoff_lat": 12.2, "dropoff_lng": 77.2,
            "weight_kg": 5000, "length_m": 5, "width_m": 2, "height_m": 2,
            "payment_inr": 2000,
            "pickup_deadline": (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat(),
        }
        result = find_mid_trip_loads(
            {"lat": 12.0, "lng": 77.0},
            [],
            {"weight_kg": 1000, "length_m": 10, "width_m": 2, "height_m": 2},
            [load],
        )
        assert result["recommendations"] == []

    def test_valid_load_is_recommended(self):
        """A load within capacity and deadline must be recommended."""
        load = {
            "load_id": "L1",
            "pickup_lat": 12.1, "pickup_lng": 77.1,
            "dropoff_lat": 12.2, "dropoff_lng": 77.2,
            "weight_kg": 500, "length_m": 2, "width_m": 1, "height_m": 1,
            "payment_inr": 2000,
            "pickup_deadline": (datetime.now(timezone.utc) + timedelta(hours=48)).isoformat(),
        }
        result = find_mid_trip_loads(
            {"lat": 12.0, "lng": 77.0},
            [],
            {"weight_kg": 1000, "length_m": 10, "width_m": 2, "height_m": 2},
            [load],
        )
        assert len(result["recommendations"]) == 1
        rec = result["recommendations"][0]
        assert rec["load_id"] == "L1"
        assert set(rec.keys()) == {
            "load_id", "detour_km", "detour_minutes", "additional_earnings",
            "priority_score", "pickup_location", "dropoff_location",
        }

    def test_results_are_sorted_by_priority_desc(self):
        """Recommendations must be sorted by priority_score descending."""
        now = datetime.now(timezone.utc)
        base_cap = {"weight_kg": 100000, "length_m": 100, "width_m": 100, "height_m": 100}
        loads = [
            {
                "load_id": f"L{i}",
                "pickup_lat": 12.0 + i * 0.5, "pickup_lng": 77.0,
                "dropoff_lat": 12.1 + i * 0.5, "dropoff_lng": 77.1,
                "weight_kg": 100, "length_m": 1, "width_m": 1, "height_m": 1,
                "payment_inr": 1000 * (i + 1),
                "pickup_deadline": (now + timedelta(hours=48 + i)).isoformat(),
            }
            for i in range(3)
        ]
        result = find_mid_trip_loads(
            {"lat": 12.0, "lng": 77.0},
            [],
            base_cap,
            loads,
        )
        scores = [r["priority_score"] for r in result["recommendations"]]
        assert scores == sorted(scores, reverse=True)

    def test_unparseable_deadline_is_skipped(self):
        """A load with an invalid deadline must be skipped."""
        load = {
            "load_id": "L-bad",
            "pickup_lat": 12.1, "pickup_lng": 77.1,
            "dropoff_lat": 12.2, "dropoff_lng": 77.2,
            "weight_kg": 500, "length_m": 2, "width_m": 1, "height_m": 1,
            "payment_inr": 2000,
            "pickup_deadline": "not-a-date",
        }
        result = find_mid_trip_loads(
            {"lat": 12.0, "lng": 77.0},
            [],
            {"weight_kg": 1000, "length_m": 10, "width_m": 2, "height_m": 2},
            [load],
        )
        assert result["recommendations"] == []
