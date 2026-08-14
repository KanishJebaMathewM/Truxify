"""Unit tests for backend/ml/app/models/bin_packing.py.

Run with: python3 -m pytest tests/test_bin_packing_algo.py -v --no-header
"""
import pytest

from app.models.bin_packing import (
    _haversine,
    optimise_packing,
)


def make_truck(**overrides):
    truck = {
        "length": 10.0,
        "width": 2.5,
        "height": 2.5,
        "max_weight": 10000.0,
    }
    truck.update(overrides)
    return truck


def make_packages(n=1):
    return [
        {"length": 1.0, "width": 1.0, "height": 1.0, "weight": 100.0}
        for _ in range(n)
    ]


def make_addresses(n=1):
    return [
        {"lat": 12.0 + i * 0.01, "lng": 77.0 + i * 0.01}
        for i in range(n)
    ]


class TestHaversine:
    """Tests for the great-circle distance helper."""

    def test_same_point_is_zero(self):
        assert _haversine(12.0, 77.0, 12.0, 77.0) == 0.0

    def test_known_distance(self):
        dist = _haversine(28.61, 77.21, 19.08, 72.88)
        assert 1000 < dist < 1300


class TestOptimisePacking:
    """Tests for the packing + stop-sequencing optimizer."""

    def test_no_packages(self):
        result = optimise_packing([], make_truck(), [])
        assert result == {
            "packing_arrangement": [],
            "unpacked_packages": [],
            "stop_sequence": [],
            "utilization_pct": 0.0,
        }

    def test_missing_addresses_raises(self):
        with pytest.raises(ValueError):
            optimise_packing(make_packages(1), make_truck(), [])

    def test_single_package_is_packed(self):
        result = optimise_packing(make_packages(1), make_truck(), make_addresses(1))
        assert len(result["packing_arrangement"]) == 1
        assert result["packing_arrangement"][0]["fits"] is True
        assert result["unpacked_packages"] == []
        assert result["stop_sequence"] == [0]

    def test_oversized_package_is_unpacked(self):
        """A package larger than the truck must be left unpacked."""
        packages = [{"length": 100.0, "width": 100.0, "height": 100.0, "weight": 1.0}]
        result = optimise_packing(packages, make_truck(), make_addresses(1))
        assert result["packing_arrangement"][0]["fits"] is False
        assert result["unpacked_packages"] == [0]

    def test_overweight_package_is_unpacked(self):
        """A package heavier than the truck capacity must be left unpacked."""
        packages = [{"length": 1.0, "width": 1.0, "height": 1.0, "weight": 50000.0}]
        result = optimise_packing(packages, make_truck(), make_addresses(1))
        assert result["packing_arrangement"][0]["fits"] is False
        assert result["unpacked_packages"] == [0]

    def test_utilization_is_non_negative(self):
        """The reported utilisation must be within 0..100."""
        result = optimise_packing(make_packages(3), make_truck(), make_addresses(3))
        assert 0.0 <= result["utilization_pct"] <= 100.0

    def test_stop_sequence_has_one_entry_per_packed_package(self):
        """The stop sequence must cover every packed package."""
        result = optimise_packing(make_packages(4), make_truck(), make_addresses(4))
        assert sorted(result["stop_sequence"]) == sorted(
            a["package_index"] for a in result["packing_arrangement"] if a["fits"]
        )
