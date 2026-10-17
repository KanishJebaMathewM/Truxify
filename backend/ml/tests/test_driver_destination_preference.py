import pytest

pytest.importorskip("fastapi")

from app.models.bilateral_matcher import _destination_penalty
from main import DriverItem


def _driver(**overrides):
    values = {
        "current_lat": 12.9,
        "current_lng": 77.5,
        "max_weight_kg": 5000,
        "max_length_m": 10,
        "max_width_m": 3,
        "max_height_m": 3,
        "rating": 4.5,
    }
    values.update(overrides)
    return DriverItem(**values).model_dump()


def _load():
    return {"dest_lat": 12.1, "dest_lng": 77.1}


def test_omitted_destination_preference_has_no_penalty():
    driver = _driver()

    assert driver["preferred_dest_lat"] is None
    assert driver["preferred_dest_lng"] is None
    assert _destination_penalty(driver, _load()) == 0.0


def test_explicit_zero_destination_remains_a_real_preference():
    driver = _driver(preferred_dest_lat=0.0, preferred_dest_lng=0.0)

    assert driver["preferred_dest_lat"] == 0.0
    assert driver["preferred_dest_lng"] == 0.0
    assert _destination_penalty(driver, _load()) > 0.0
