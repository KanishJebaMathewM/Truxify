import pytest

from app.models.deadhead_eliminator import find_return_loads


def test_invalid_arrival_time_raises_value_error():
    with pytest.raises(ValueError, match="arrival_time must be a valid ISO-8601 timestamp"):
        find_return_loads(
            driver_destination={"lat": 12.97, "lng": 77.62},
            truck_specs={
                "max_weight_kg": 10000,
                "max_length_m": 10,
                "max_width_m": 2.5,
                "max_height_m": 3,
            },
            arrival_time="not-a-timestamp",
            available_loads=[{
                "load_id": "L-INVALID-ARRIVAL",
                "origin_lat": 12.98,
                "origin_lng": 77.63,
                "dest_lat": 13.1,
                "dest_lng": 77.8,
                "weight_kg": 100,
                "length_m": 1,
                "width_m": 1,
                "height_m": 1,
                "pickup_deadline": "2026-08-10T14:00:00",
                "payment_inr": 1000,
            }],
        )
