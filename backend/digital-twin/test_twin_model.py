"""Suite for twin_model.py — the 1,046-line core had only simulator-level tests."""
import math
from datetime import datetime

import pytest

from twin_model import (
    DigitalTwin,
    LogisticsAsset,
    LogisticsEvent,
    _clamp,
    _distance_km,
    _validate_location,
)


def make_asset(asset_id="TRUCK-1", **kw):
    params = dict(
        id=asset_id,
        type="truck",
        location={"lat": 28.6139, "lng": 77.2090},  # Delhi
        status="active",
    )
    params.update(kw)
    return LogisticsAsset(**params)


class TestValidateLocation:
    def test_normalizes_to_float(self):
        assert _validate_location({"lat": "28.5", "lng": 77}) == {"lat": 28.5, "lng": 77.0}

    @pytest.mark.parametrize("bad", [
        None, "28,77", {}, {"lat": 28.5}, {"lng": 77},
        {"lat": "abc", "lng": 77}, {"lat": float("nan"), "lng": 77},
        {"lat": 91, "lng": 77}, {"lat": -91, "lng": 77},
        {"lat": 28, "lng": 181}, {"lat": 28, "lng": -181},
    ])
    def test_rejects_invalid(self, bad):
        with pytest.raises(ValueError):
            _validate_location(bad)

    def test_boundary_values_accepted(self):
        assert _validate_location({"lat": 90, "lng": 180}) == {"lat": 90.0, "lng": 180.0}
        assert _validate_location({"lat": -90, "lng": -180}) == {"lat": -90.0, "lng": -180.0}


class TestClamp:
    def test_inside_below_above(self):
        assert _clamp(5, 0, 10) == 5
        assert _clamp(-3, 0, 10) == 0
        assert _clamp(99, 0, 10) == 10


class TestDistanceKm:
    def test_zero_distance(self):
        p = {"lat": 28.6139, "lng": 77.2090}
        assert _distance_km(p, p) == pytest.approx(0.0, abs=1e-9)

    def test_known_route(self):
        delhi = {"lat": 28.6139, "lng": 77.2090}
        mumbai = {"lat": 19.0760, "lng": 72.8777}
        # ~1150 km great-circle — allow 2% tolerance for the approximation
        d = _distance_km(delhi, mumbai)
        assert 1100 < d < 1200

    def test_symmetric(self):
        a = {"lat": 12.9716, "lng": 77.5946}
        b = {"lat": 13.0827, "lng": 80.2707}
        assert _distance_km(a, b) == pytest.approx(_distance_km(b, a), rel=1e-9)

    def test_antimeridian_crossing(self):
        a = {"lat": 0, "lng": 179.9}
        b = {"lat": 0, "lng": -179.9}
        d = _distance_km(a, b)
        assert d < 50, "should cross the antimeridian, not go the long way"

    def test_invalid_points_raise(self):
        with pytest.raises(ValueError):
            _distance_km({"lat": 95, "lng": 0}, {"lat": 0, "lng": 0})


class TestLogisticsAsset:
    def test_rejects_empty_id_and_type(self):
        with pytest.raises(ValueError):
            make_asset(id="")
        with pytest.raises(ValueError):
            make_asset(type="")

    def test_validates_location_at_construction(self):
        with pytest.raises(ValueError):
            make_asset(location={"lat": 999, "lng": 0})

    def test_to_dict_round_shape(self):
        d = make_asset().to_dict()
        assert d["id"] == "TRUCK-1"
        assert d["location"] == {"lat": 28.6139, "lng": 77.2090}
        datetime.fromisoformat(d["created_at"])  # must not raise


class TestDigitalTwinCRUD:
    def test_add_get_update_remove(self):
        twin = DigitalTwin()
        twin.add_asset(make_asset())
        assert twin.get_asset_state("TRUCK-1")["status"] == "active"

        assert twin.update_asset("TRUCK-1", {"status": "maintenance"}) is True
        assert twin.get_asset_state("TRUCK-1")["status"] == "maintenance"

        assert twin.remove_asset("TRUCK-1") is True
        assert twin.get_asset_state("TRUCK-1") is None
        assert twin.remove_asset("TRUCK-1") is False

    def test_duplicate_add_rejected(self):
        twin = DigitalTwin()
        twin.add_asset(make_asset())
        with pytest.raises(ValueError, match="already exists"):
            twin.add_asset(make_asset())

    def test_update_missing_asset_returns_false(self):
        assert DigitalTwin().update_asset("GHOST", {"status": "x"}) is False

    def test_update_rejects_unknown_fields(self):
        twin = DigitalTwin()
        twin.add_asset(make_asset())
        with pytest.raises(ValueError, match="Unsupported asset field"):
            twin.update_asset("TRUCK-1", {"created_at": datetime.now()})

    def test_update_validates_location(self):
        twin = DigitalTwin()
        twin.add_asset(make_asset())
        with pytest.raises(ValueError):
            twin.update_asset("TRUCK-1", {"location": {"lat": 200, "lng": 0}})

    def test_update_bumps_updated_at(self):
        twin = DigitalTwin()
        asset = twin.add_asset(make_asset())
        before = asset.updated_at
        twin.update_asset("TRUCK-1", {"status": "idle"})
        assert twin.assets["TRUCK-1"].updated_at >= before

    def test_get_all_assets(self):
        twin = DigitalTwin()
        twin.add_asset(make_asset("A"))
        twin.add_asset(make_asset("B"))
        assert {a["id"] for a in twin.get_all_assets()} == {"A", "B"}


class TestEvents:
    def test_add_and_filter_events(self):
        twin = DigitalTwin()
        twin.add_asset(make_asset())
        ev = LogisticsEvent(
            id="EV-1", type="location_update", timestamp=datetime.now(),
            asset_id="TRUCK-1", location={"lat": 28.6, "lng": 77.2},
        )
        twin.add_event(ev)
        events = twin.get_events(asset_id="TRUCK-1")
        assert len(events) == 1
        assert events[0]["type"] == "location_update"

    def test_event_rejects_unknown_asset(self):
        twin = DigitalTwin()
        ev = LogisticsEvent(
            id="EV-9", type="x", timestamp=datetime.now(),
            asset_id="GHOST", location={"lat": 0, "lng": 0},
        )
        with pytest.raises(ValueError, match="does not exist"):
            twin.add_event(ev)

    def test_event_limit_zero_returns_empty(self):
        twin = DigitalTwin()
        twin.add_asset(make_asset())
        twin.add_event(LogisticsEvent(
            id="EV-1", type="ping", timestamp=datetime.now(),
            asset_id="TRUCK-1", location={"lat": 28.6, "lng": 77.2},
        ))
        assert twin.get_events(limit=0) == []
