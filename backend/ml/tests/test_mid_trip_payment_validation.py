from datetime import datetime, timedelta, timezone

from app.models.mid_trip_reoptimiser import find_mid_trip_loads


def _capacity():
    return {
        "weight_kg": 1000,
        "length_m": 10,
        "width_m": 3,
        "height_m": 3,
    }


def _load(payment):
    return {
        "load_id": f"payment-{payment}",
        "pickup_lat": 12.1,
        "pickup_lng": 77.1,
        "dropoff_lat": 12.2,
        "dropoff_lng": 77.2,
        "weight_kg": 100,
        "length_m": 2,
        "width_m": 1,
        "height_m": 1,
        "payment_inr": payment,
        "pickup_deadline": (
            datetime.now(timezone.utc) + timedelta(hours=24)
        ).isoformat(),
    }


def _recommendations_for(payment):
    return find_mid_trip_loads(
        {"lat": 12.0, "lng": 77.0},
        [],
        _capacity(),
        [_load(payment)],
    )["recommendations"]


def test_zero_payment_is_not_recommended():
    assert _recommendations_for(0) == []


def test_negative_payment_is_not_recommended():
    assert _recommendations_for(-1) == []


def test_non_finite_payment_is_not_recommended():
    assert _recommendations_for(float("nan")) == []
    assert _recommendations_for(float("inf")) == []


def test_positive_payment_is_recommended():
    recommendations = _recommendations_for(2000)
    assert len(recommendations) == 1
    assert recommendations[0]["additional_earnings"] == 2000.0
