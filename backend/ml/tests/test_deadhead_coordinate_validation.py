import math

import pytest

from app.models.deadhead_eliminator import find_return_loads


TRUCK = {
    "max_weight_kg": 10000,
    "max_length_m": 10,
    "max_width_m": 3,
    "max_height_m": 3,
}


def _load():
    return {
        "load_id": "L1",
        "origin_lat": 12.98,
        "origin_lng": 77.63,
        "dest_lat": 13.1,
        "dest_lng": 77.8,
        "weight_kg": 1000,
        "length_m": 2,
        "width_m": 1,
        "height_m": 1,
        "pickup_deadline": "2030-01-02T00:00:00+00:00",
        "payment_inr": 5000,
    }


@pytest.mark.parametrize(
    "field",
    ["origin_lat", "origin_lng", "dest_lat", "dest_lng"],
)
def test_missing_load_coordinate_raises(field):
    load = _load()
    load.pop(field)

    with pytest.raises(ValueError, match=field):
        find_return_loads(
            {"lat": 12.97, "lng": 77.62},
            TRUCK,
            "2030-01-01T00:00:00+00:00",
            [load],
        )


@pytest.mark.parametrize(
    "field,value",
    [
        ("origin_lat", math.nan),
        ("origin_lng", math.inf),
        ("dest_lat", -math.inf),
        ("dest_lng", 181.0),
        ("dest_lat", 91.0),
        ("origin_lng", -181.0),
    ],
)
def test_non_finite_and_out_of_range_coordinates_raise(field, value):
    load = _load()
    load[field] = value

    with pytest.raises(ValueError, match=field):
        find_return_loads(
            {"lat": 12.97, "lng": 77.62},
            TRUCK,
            "2030-01-01T00:00:00+00:00",
            [load],
        )


def test_missing_driver_destination_coordinate_raises_before_matching():
    with pytest.raises(ValueError, match="driver_destination.lat"):
        find_return_loads(
            {"lng": 77.62},
            TRUCK,
            "2030-01-01T00:00:00+00:00",
            [_load()],
        )


def test_valid_coordinates_still_match():
    result = find_return_loads(
        {"lat": 12.97, "lng": 77.62},
        TRUCK,
        "2030-01-01T00:00:00+00:00",
        [_load()],
    )

    assert len(result["recommendations"]) == 1
