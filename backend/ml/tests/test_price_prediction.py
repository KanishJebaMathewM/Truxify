import os
import sys
from datetime import datetime

import numpy as np
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from main import app
from app.models import price_prediction as pp
from app.models.base import MODEL_STORAGE_DIR

client = TestClient(app, headers={'X-API-Key': 'test_key'})


def _cleanup_price_model():
    for filename in ("price_forecast.pkl", "price_forecast_meta.json"):
        path = os.path.join(MODEL_STORAGE_DIR, filename)
        if os.path.exists(path):
            os.remove(path)


@pytest.fixture(autouse=True)
def _isolate_price_model():
    """Give every test a clean slate: no persisted price model survives."""
    _cleanup_price_model()
    yield
    _cleanup_price_model()


def _fake_trip_rows(n: int = 150):
    """Realistic completed-trip rows returned by the (mocked) data loader."""
    rng = np.random.default_rng(7)
    cities = ["Mumbai", "Delhi", "Pune", "Ahmedabad", "Chennai", "Kolkata", "Bengaluru", "Hyderabad"]
    goods = ["general", "perishable", "fragile", "hazardous", "bulk"]
    trucks = ["Open Body", "Closed Body", "Container", "Refrigerated"]
    rows = []
    for i in range(n):
        rows.append({
            "pickup_address": f"Warehouse {i}, {cities[i % len(cities)]}, MH 400001",
            "pickup_lat": float(18.5 + (i % 10) * 0.05),
            "pickup_lng": float(72.8 + (i % 10) * 0.05),
            "drop_address": f"Godown {i}, {cities[(i + 3) % len(cities)]}, DL 110001",
            "drop_lat": float(28.6 + (i % 10) * 0.05),
            "drop_lng": float(77.2 + (i % 10) * 0.05),
            "weight_tonnes": float(1 + (i % 20)),
            "goods_type": goods[i % len(goods)],
            "created_at": datetime(2026, 1 + (i % 12), 1 + (i % 27), i % 24),
            "truck_id": f"truck-{i}",
            "truck_type": trucks[i % len(trucks)],
            "bid_amount": 1_500_000 + i * 1000,
            "total_amount": 1_600_000 + i * 1000,
        })
    return rows


# ---------------------------------------------------------------------------
# Gating: no auto-train on synthetic randomness
# ---------------------------------------------------------------------------

def test_predict_price_gated_without_real_model():
    """Without a real-data model the endpoint returns 503 (no synthetic auto-train)."""
    payload = {"distance_km": 500.0, "cargo_weight_kg": 10000.0}
    response = client.post("/predict/price", json=payload)
    assert response.status_code == 503


def test_train_price_no_historical_data(monkeypatch):
    """Training with no completed trips must not persist a model."""
    monkeypatch.setattr(pp, "load_historical_trips", lambda max_samples=20000: [])
    response = client.post("/train/price")
    assert response.status_code == 503
    assert not os.path.exists(os.path.join(MODEL_STORAGE_DIR, "price_forecast.pkl"))


# ---------------------------------------------------------------------------
# Training on real (historical) data
# ---------------------------------------------------------------------------

def test_train_price_with_historical_data(monkeypatch):
    """POST /train/price over real completed trips returns real metrics."""
    monkeypatch.setattr(pp, "load_historical_trips", lambda max_samples=20000: _fake_trip_rows(150))
    response = client.post("/train/price")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "metrics" in data
    assert "r2" in data["metrics"]
    assert "mae" in data["metrics"]
    assert "rmse" in data["metrics"]
    assert data["metrics"]["is_real_model"] is True
    assert data["metrics"]["data_source"] == "postgres_completed_trips"


# ---------------------------------------------------------------------------
# Valid prediction tests (after a real model is persisted)
# ---------------------------------------------------------------------------

def test_predict_price_valid_after_real_training(monkeypatch):
    """Full payload with all fields — 200 with correct schema."""
    monkeypatch.setattr(pp, "load_historical_trips", lambda max_samples=20000: _fake_trip_rows(150))
    assert client.post("/train/price").status_code == 200

    payload = {
        "distance_km": 500.0,
        "cargo_weight_kg": 10000.0,
        "truck_type": "heavy_truck",
        "route_origin": "Mumbai",
        "route_destination": "Delhi",
        "hour_of_day": 14,
        "day_of_week": 3,
        "month": 10,
        "fuel_price": 110.0,
        "cargo_type": "general",
    }
    response = client.post("/predict/price", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "estimated_price" in data
    assert isinstance(data["estimated_price"], float)
    assert data["estimated_price"] > 0
    assert "min_price" in data
    assert "max_price" in data
    assert data["currency"] == "INR"


def test_predict_price_minimal(monkeypatch):
    """Backward-compat: only distance_km and cargo_weight_kg required."""
    monkeypatch.setattr(pp, "load_historical_trips", lambda max_samples=20000: _fake_trip_rows(150))
    assert client.post("/train/price").status_code == 200

    payload = {
        "distance_km": 100.0,
        "cargo_weight_kg": 1000.0,
    }
    response = client.post("/predict/price", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["estimated_price"] > 0
    assert data["currency"] == "INR"


# ---------------------------------------------------------------------------
# Input validation tests (422)
# ---------------------------------------------------------------------------

def test_predict_price_invalid_distance():
    """distance_km=0 violates gt=0 constraint — expect 422."""
    payload = {
        "distance_km": 0,
        "cargo_weight_kg": 1000.0,
    }
    response = client.post("/predict/price", json=payload)
    assert response.status_code == 422


def test_predict_price_invalid_weight():
    """cargo_weight_kg=0 violates gt=0 constraint — expect 422."""
    payload = {
        "distance_km": 100.0,
        "cargo_weight_kg": 0,
    }
    response = client.post("/predict/price", json=payload)
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# Output schema / confidence range
# ---------------------------------------------------------------------------

def test_predict_price_confidence_range(monkeypatch):
    """min_price <= estimated_price <= max_price."""
    monkeypatch.setattr(pp, "load_historical_trips", lambda max_samples=20000: _fake_trip_rows(150))
    assert client.post("/train/price").status_code == 200

    payload = {
        "distance_km": 300.0,
        "cargo_weight_kg": 5000.0,
        "truck_type": "medium_truck",
        "fuel_price": 105.0,
    }
    response = client.post("/predict/price", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["min_price"] <= data["estimated_price"] <= data["max_price"]


# ---------------------------------------------------------------------------
# API key auth tests
# ---------------------------------------------------------------------------

def test_predict_price_auth_missing(monkeypatch):
    """When ML_API_KEY is set but no header is sent — expect 401."""
    monkeypatch.setenv("ML_API_KEY", "test-secret-key")
    payload = {
        "distance_km": 500.0,
        "cargo_weight_kg": 10000.0,
    }
    response = client.post("/predict/price", json=payload)
    assert response.status_code == 401
    assert response.json() == {"detail": "Unauthorized"}


def test_predict_price_auth_valid(monkeypatch):
    """Correct API key passes auth — endpoint then gates at 503 (no real model)."""
    monkeypatch.setenv("ML_API_KEY", "test-secret-key")
    payload = {
        "distance_km": 500.0,
        "cargo_weight_kg": 10000.0,
    }
    response = client.post(
        "/predict/price",
        json=payload,
        headers={"X-API-Key": "test-secret-key"},
    )
    assert response.status_code == 503


# ---------------------------------------------------------------------------
# Async weather multiplier tests
# ---------------------------------------------------------------------------

def test_get_weather_multiplier_returns_float():
    """_get_weather_multiplier (sync) returns a float multiplier without blocking."""
    result = pp._get_weather_multiplier("")  # empty city returns 1.0 immediately
    assert isinstance(result, float)
    assert result == 1.0


def test_get_weather_multiplier_async_no_api_key(monkeypatch):
    """_get_weather_multiplier_async returns 1.0 when OPENWEATHERMAP_API_KEY is not set."""
    monkeypatch.delenv("OPENWEATHERMAP_API_KEY", raising=False)
    import asyncio
    async def run():
        async with pp.httpx.AsyncClient() as client:
            return await pp._get_weather_multiplier_async(client, "London")
    result = asyncio.run(run())
    assert result == 1.0


def test_get_weather_multiplier_async_empty_city():
    """_get_weather_multiplier_async returns 1.0 for empty city."""
    import asyncio
    async def run():
        async with pp.httpx.AsyncClient() as client:
            return await pp._get_weather_multiplier_async(client, "")
    result = asyncio.run(run())
    assert result == 1.0
