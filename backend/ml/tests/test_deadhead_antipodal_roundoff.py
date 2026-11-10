"""Valid antipodes must remain usable by distance and return-load scoring."""
import math

import pytest

from app.models import deadhead_eliminator as deadhead


START = {"lat": 72.1609601066408, "lng": -163.30237895187088}
END = {"lat": -72.1609601066408, "lng": 16.697621048129122}


@pytest.mark.parametrize("first,second", [(START, END), (END, START)])
def test_antipodal_roundoff_returns_half_earth_circumference(first, second):
    distance = deadhead._haversine(first["lat"], first["lng"], second["lat"], second["lng"])
    assert math.isfinite(distance)
    assert distance == pytest.approx(math.pi * 6371.0, abs=1e-6)


def test_return_load_with_antipodal_delivery_can_be_scored(monkeypatch):
    monkeypatch.setenv("TRUXIFY_ML_USE_OSRM", "false")
    result = deadhead.find_return_loads(
        START,
        {"max_weight_kg": 1000, "max_length_m": 10, "max_width_m": 3, "max_height_m": 3},
        "2026-10-06T00:00:00+00:00",
        [{
            "load_id": "antipodal-delivery",
            "origin_lat": START["lat"], "origin_lng": START["lng"],
            "dest_lat": END["lat"], "dest_lng": END["lng"],
            "weight_kg": 100, "length_m": 1, "width_m": 1, "height_m": 1,
            "pickup_deadline": "2026-10-07T00:00:00+00:00",
            "payment_inr": 1000000,
        }],
    )
    recommendation, = result["recommendations"]
    assert recommendation["load_id"] == "antipodal-delivery"
    assert recommendation["distance_to_pickup_km"] == 0
    assert math.isfinite(recommendation["estimated_profit_inr"])
    assert recommendation["estimated_profit_inr"] > 0
