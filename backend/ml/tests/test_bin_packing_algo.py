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


def make_route_start(**overrides):
    route_start = {"lat": 12.0, "lng": 77.0}
    route_start.update(overrides)
    return route_start


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
        result = optimise_packing([], make_truck(), [], make_route_start())
        assert result == {
            "packing_arrangement": [],
            "unpacked_packages": [],
            "stop_sequence": [],
            "utilization_pct": 0.0,
        }

    def test_missing_route_start_raises(self):
        with pytest.raises(ValueError):
            optimise_packing(make_packages(1), make_truck(), make_addresses(1), None)

    def test_invalid_route_start_raises(self):
        with pytest.raises(ValueError):
            optimise_packing(
                make_packages(1),
                make_truck(),
                make_addresses(1),
                {"lat": 91.0, "lng": 77.0},
            )

    def test_missing_addresses_raises(self):
        with pytest.raises(ValueError):
            optimise_packing(make_packages(1), make_truck(), [], make_route_start())

    def test_single_package_is_packed(self):
        result = optimise_packing(
            make_packages(1), make_truck(), make_addresses(1), make_route_start()
        )
        assert len(result["packing_arrangement"]) == 1
        assert result["packing_arrangement"][0]["fits"] is True
        assert result["unpacked_packages"] == []
        assert result["stop_sequence"] == [0]

    def test_oversized_package_is_unpacked(self):
        """A package larger than the truck must be left unpacked."""
        packages = [{"length": 100.0, "width": 100.0, "height": 100.0, "weight": 1.0}]
        result = optimise_packing(
            packages, make_truck(), make_addresses(1), make_route_start()
        )
        assert result["packing_arrangement"][0]["fits"] is False
        assert result["unpacked_packages"] == [0]

    def test_overweight_package_is_unpacked(self):
        """A package heavier than the truck capacity must be left unpacked."""
        packages = [{"length": 1.0, "width": 1.0, "height": 1.0, "weight": 50000.0}]
        result = optimise_packing(
            packages, make_truck(), make_addresses(1), make_route_start()
        )
        assert result["packing_arrangement"][0]["fits"] is False
        assert result["unpacked_packages"] == [0]

    @pytest.mark.parametrize(
        "truck_dimensions",
        [
            (1.0, 2.0, 3.0),
            (1.0, 3.0, 2.0),
            (2.0, 1.0, 3.0),
            (2.0, 3.0, 1.0),
            (3.0, 1.0, 2.0),
            (3.0, 2.0, 1.0),
        ],
    )
    def test_package_can_use_all_axis_aligned_orientations(self, truck_dimensions):
        """Each permutation of L/W/H must be considered as a valid orientation."""
        truck = make_truck(
            length=truck_dimensions[0],
            width=truck_dimensions[1],
            height=truck_dimensions[2],
        )
        package = [{"length": 1.0, "width": 2.0, "height": 3.0, "weight": 100.0}]

        result = optimise_packing(
            package, truck, make_addresses(1), make_route_start()
        )

        arrangement = result["packing_arrangement"][0]
        assert arrangement["fits"] is True
        assert result["unpacked_packages"] == []
        assert result["stop_sequence"] == [0]

    def test_utilization_is_non_negative(self):
        """The reported utilisation must be within 0..100."""
        result = optimise_packing(
            make_packages(3), make_truck(), make_addresses(3), make_route_start()
        )
        assert 0.0 <= result["utilization_pct"] <= 100.0

    def test_stop_sequence_has_one_entry_per_packed_package(self):
        """The stop sequence must cover every packed package."""
        result = optimise_packing(
            make_packages(4), make_truck(), make_addresses(4), make_route_start()
        )
        assert sorted(result["stop_sequence"]) == sorted(
            a["package_index"] for a in result["packing_arrangement"] if a["fits"]
        )

    def test_stop_sequence_starts_from_route_depot(self):
        packages = make_packages(2)
        addresses = [
            {"lat": 12.0, "lng": 77.0},
            {"lat": 13.0, "lng": 78.0},
        ]

        result = optimise_packing(
            packages,
            make_truck(),
            addresses,
            make_route_start(lat=13.0, lng=78.0),
        )

        assert result["stop_sequence"] == [1, 0]

    def test_stop_sequence_is_deterministic_when_distances_tie(self):
        packages = make_packages(2)
        addresses = [
            {"lat": 12.0, "lng": 77.0},
            {"lat": 12.0, "lng": 77.0},
        ]

        result = optimise_packing(
            packages,
            make_truck(),
            addresses,
            make_route_start(lat=11.0, lng=76.0),
        )

        assert result["stop_sequence"] == [0, 1]
