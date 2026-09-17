import math

from app.models.deadhead_eliminator import find_return_loads


BASE_TRUCK = {
    "max_weight_kg": 10000,
    "max_length_m": 10,
    "max_width_m": 3,
    "max_height_m": 3,
    "fuel_price_inr_per_l": 100.0,
    "fuel_efficiency_km_per_l": 5.0,
    "toll_per_km_inr": 0.0,
    "operating_cost_per_km_inr": 0.0,
}


def _load(load_id, destination_lat, payment):
    return {
        "load_id": load_id,
        "origin_lat": 0.0,
        "origin_lng": 0.0,
        "dest_lat": destination_lat,
        "dest_lng": 0.0,
        "weight_kg": 1000,
        "length_m": 2,
        "width_m": 1,
        "height_m": 1,
        "pickup_deadline": "2030-01-02T00:00:00+00:00",
        "payment_inr": payment,
    }


def test_negative_net_profit_is_not_ranked_above_positive_net_profit():
    result = find_return_loads(
        driver_destination={"lat": 0.0, "lng": 0.0},
        truck_specs=BASE_TRUCK,
        arrival_time="2030-01-01T00:00:00+00:00",
        available_loads=[
            # About 1,000 km of loaded travel at ₹20/km fuel cost: gross looks
            # attractive, but the incremental trip loses money.
            _load("negative-net", 9.0, 10_000),
            # About 100 km of loaded travel at the same fuel cost: positive net.
            _load("positive-net", 0.9, 4_000),
        ],
    )

    recommendations = result["recommendations"]
    assert [item["load_id"] for item in recommendations] == ["positive-net"]
    assert recommendations[0]["estimated_profit_inr"] > 0
    assert recommendations[0]["estimated_cost_inr"] < recommendations[0]["estimated_earnings"]
    assert recommendations[0]["profit_per_km"] > 0


def test_load_specific_toll_is_included_in_incremental_cost():
    load = _load("with-toll", 0.9, 4_000)
    load["toll_estimate_inr"] = 1_000

    result = find_return_loads(
        driver_destination={"lat": 0.0, "lng": 0.0},
        truck_specs=BASE_TRUCK,
        arrival_time="2030-01-01T00:00:00+00:00",
        available_loads=[load],
    )

    recommendation = result["recommendations"][0]
    assert math.isclose(recommendation["estimated_cost_inr"], 3001.51, abs_tol=0.01)
    assert math.isclose(recommendation["estimated_profit_inr"], 998.49, abs_tol=0.01)
