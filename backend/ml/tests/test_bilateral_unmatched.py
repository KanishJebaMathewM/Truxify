from app.models.bilateral_matcher import match_bilateral


def _load(origin_lat, origin_lng, deadline_hours=1000.0):
    return {
        "origin_lat": origin_lat,
        "origin_lng": origin_lng,
        "dest_lat": origin_lat,
        "dest_lng": origin_lng,
        "weight_kg": 1000.0,
        "length_m": 2.0,
        "width_m": 2.0,
        "height_m": 2.0,
        "deadline_hours": deadline_hours,
    }


def _driver(current_lat, current_lng):
    return {
        "current_lat": current_lat,
        "current_lng": current_lng,
        "max_weight_kg": 5000.0,
        "max_length_m": 5.0,
        "max_width_m": 3.0,
        "max_height_m": 3.0,
        "rating": 3.0,
    }


def test_poor_but_feasible_pair_can_remain_unmatched():
    result = match_bilateral(
        [_load(0.0, 180.0)],
        [_driver(0.0, 0.0)],
    )

    assert result["assignments"] == []
    assert result["unmatched_loads"] == [0]
    assert result["unmatched_drivers"] == [0]


def test_good_pair_is_still_matched():
    result = match_bilateral(
        [_load(12.9716, 77.5946)],
        [_driver(12.9716, 77.5946)],
    )

    assert len(result["assignments"]) == 1
    assert result["assignments"][0]["load_index"] == 0
    assert result["assignments"][0]["driver_index"] == 0
    assert result["assignments"][0]["match_score"] > 0.0
