import math

import pytest

from app.models.bilateral_matcher import match_bilateral


def _load(**overrides):
    value = {
        "origin_lat": 12.0,
        "origin_lng": 77.0,
        "dest_lat": 12.1,
        "dest_lng": 77.1,
        "weight_kg": 500,
        "length_m": 2,
        "width_m": 1,
        "height_m": 1,
        "deadline_hours": 24,
    }
    value.update(overrides)
    return value


def _driver(**overrides):
    value = {
        "current_lat": 12.05,
        "current_lng": 77.05,
        "max_weight_kg": 5000,
        "max_length_m": 10,
        "max_width_m": 3,
        "max_height_m": 3,
        "preferred_dest_lat": 12.1,
        "preferred_dest_lng": 77.1,
        "rating": 4.5,
    }
    value.update(overrides)
    return value


@pytest.mark.parametrize("field", ["origin_lat", "origin_lng", "dest_lat", "dest_lng"])
@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf])
def test_non_finite_load_coordinates_are_rejected(field, value):
    with pytest.raises(ValueError, match=field):
        match_bilateral([_load(**{field: value})], [_driver()])


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("origin_lat", 91.0),
        ("origin_lat", -91.0),
        ("dest_lat", 91.0),
        ("dest_lat", -91.0),
        ("origin_lng", 181.0),
        ("origin_lng", -181.0),
        ("dest_lng", 181.0),
        ("dest_lng", -181.0),
    ],
)
def test_out_of_range_load_coordinates_are_rejected(field, value):
    with pytest.raises(ValueError, match=field):
        match_bilateral([_load(**{field: value})], [_driver()])


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("weight_kg", 0),
        ("weight_kg", -1),
        ("length_m", 0),
        ("deadline_hours", 0),
    ],
)
def test_non_positive_load_fields_are_rejected(field, value):
    with pytest.raises(ValueError, match=field):
        match_bilateral([_load(**{field: value})], [_driver()])


@pytest.mark.parametrize("field", ["current_lat", "current_lng"])
@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf])
def test_non_finite_driver_coordinates_are_rejected(field, value):
    with pytest.raises(ValueError, match=field):
        match_bilateral([_load()], [_driver(**{field: value})])


@pytest.mark.parametrize("field", ["preferred_dest_lat", "preferred_dest_lng"])
@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf])
def test_non_finite_driver_preferences_are_rejected(field, value):
    with pytest.raises(ValueError, match=field):
        match_bilateral([_load()], [_driver(**{field: value})])


def test_non_finite_driver_rating_is_rejected():
    with pytest.raises(ValueError, match="rating"):
        match_bilateral([_load()], [_driver(rating=math.nan)])


def test_out_of_range_driver_rating_is_rejected():
    with pytest.raises(ValueError, match="rating"):
        match_bilateral([_load()], [_driver(rating=5.1)])


def test_valid_boundary_coordinates_are_accepted():
    result = match_bilateral(
        [
            _load(
                origin_lat=90.0,
                origin_lng=180.0,
                dest_lat=-90.0,
                dest_lng=-180.0,
            )
        ],
        [
            _driver(
                current_lat=90.0,
                current_lng=180.0,
                preferred_dest_lat=-90.0,
                preferred_dest_lng=-180.0,
            )
        ],
    )
    assert len(result["assignments"]) == 1
