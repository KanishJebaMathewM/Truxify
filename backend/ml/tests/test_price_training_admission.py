"""Native completed-trip admission and training; no database/provider access."""

import math
import sys
from decimal import Decimal
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.models import base
from app.models import price_prediction as pp


def trip(**changes):
    row = {
        "pickup_lat": 19.076,
        "pickup_lng": 72.8777,
        "drop_lat": 28.6139,
        "drop_lng": 77.209,
        "weight_tonnes": 10,
        "bid_amount": 250000,
        "total_amount": 300000,
        "truck_type": "Open Body",
        "goods_type": "general",
        "pickup_address": "Mumbai",
        "drop_address": "Delhi",
    }
    return row | changes


def history(count=150):
    return [
        trip(
            weight_tonnes=5 + i % 30,
            bid_amount=250000 + i * 500,
            pickup_lat=19 + (i % 10) * 0.01,
        )
        for i in range(count)
    ]


@pytest.fixture(autouse=True)
def isolated_artifacts(monkeypatch, tmp_path):
    monkeypatch.setattr(base, "MODEL_STORAGE_DIR", str(tmp_path / "models"))
    monkeypatch.setattr(
        base, "MODEL_ARTIFACT_SIGNATURE_DIR", str(tmp_path / "signatures")
    )
    monkeypatch.setattr(base, "_artifact_hmac_key", lambda: b"local-test-key-only")
    monkeypatch.setattr(pp, "_get_weather_multiplier", lambda city: 1.0)


@pytest.mark.parametrize(
    "field",
    ["pickup_lat", "pickup_lng", "drop_lat", "drop_lng", "weight_tonnes", "bid_amount"],
)
@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_reject_nonfinite_row(field, value):
    assert pp._parse_trip_row(trip(**{field: value})) is None


@pytest.mark.parametrize(
    "field,value",
    [
        ("pickup_lat", 90.001),
        ("drop_lat", -90.001),
        ("pickup_lng", 180.001),
        ("drop_lng", -180.001),
        ("weight_tonnes", 1e308),
        ("weight_tonnes", Decimal("1e10000")),
        ("bid_amount", 10**1000),
        ("pickup_lat", 10**1000),
        ("weight_tonnes", 0),
        ("weight_tonnes", -1),
        ("bid_amount", 0),
    ],
)
def test_reject_unusable_domain_or_conversion(field, value):
    assert pp._parse_trip_row(trip(**{field: value})) is None


@pytest.mark.parametrize(
    "coords",
    [
        (90, 180, -90, -180),
        (0, 0, 0, 180),
        (45.12, 15.31, -45.12, -164.69),
        (42.50367668406085, -100.10205994552673, -42.50367668406085, 79.89794005447327),
        (90, 0, 0, -180),
    ],
)
def test_geographic_boundaries_are_finite(coords):
    sample = pp._parse_trip_row(
        trip(**dict(zip(["pickup_lat", "pickup_lng", "drop_lat", "drop_lng"], coords)))
    )
    assert sample is not None
    assert 0 < sample["numeric"][0] <= math.pi * 6371 + 1e-8
    assert all(math.isfinite(v) for v in sample["numeric"])


def test_valid_schema_price_precedence_and_decimal_conversion():
    sample = pp._parse_trip_row(trip(weight_tonnes=Decimal("1.25")))
    assert sample["numeric"][1] == 1250
    assert sample["price_inr"] == 2500
    assert len(sample["numeric"]) + 2 == len(pp.FEATURE_NAMES)
    assert pp._parse_trip_row(trip(bid_amount=None))["price_inr"] == 3000
    assert pp._parse_trip_row(trip(bid_amount=float("nan"))) is None
    assert pp._parse_trip_row(trip(drop_lat=19.076, drop_lng=72.8777)) is None


def test_native_fit_mixed_history_and_persisted_prediction(monkeypatch):
    good = history()
    bad = [
        trip(weight_tonnes=float("nan")),
        trip(bid_amount=float("inf")),
        trip(pickup_lat=float("inf")),
        trip(drop_lat=91),
        trip(weight_tonnes=1e308),
        trip(bid_amount=10**1000),
    ]
    monkeypatch.setattr(pp, "load_historical_trips", lambda **kwargs: good + bad)
    metrics = pp.train_price_model()
    assert metrics["n_samples"] == len(good)
    assert all(math.isfinite(metrics[k]) for k in ["mae", "rmse", "r2"])
    model, scaler, encoder = base.load_model(pp.MODEL_NAME)
    assert np.isfinite(scaler.mean_).all()
    assert np.isfinite(scaler.scale_).all()
    assert model.n_estimators == 200 and encoder
    result = pp.predict_price(
        800, 9000, route_origin="Mumbai", route_destination="Delhi"
    )
    assert all(
        math.isfinite(result[k]) and result[k] > 0
        for k in ["estimated_price", "min_price", "max_price"]
    )


def test_insufficient_valid_history_preserves_published_generation(monkeypatch):
    monkeypatch.setattr(pp, "load_historical_trips", lambda **kwargs: history())
    pp.train_price_model()
    generation = base.get_active_generation(pp.MODEL_NAME)
    before = pp.predict_price(800, 9000)
    monkeypatch.setattr(
        pp,
        "load_historical_trips",
        lambda **kwargs: (
            history(99) + [trip(weight_tonnes=float("nan")) for _ in range(100)]
        ),
    )
    with pytest.raises(pp.PriceModelDataUnavailableError, match="found 99 of 100"):
        pp.train_price_model()
    assert base.get_active_generation(pp.MODEL_NAME) == generation
    assert pp.predict_price(800, 9000) == before
