import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from main import app

client = TestClient(app)


# ---------------------------------------------------------------------------
# Valid prediction tests
# ---------------------------------------------------------------------------

def test_predict_price_valid():
    """Full payload with all fields — 200 with correct schema."""
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


def test_predict_price_minimal():
    """Backward-compat: only distance_km and cargo_weight_kg required."""
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

def test_predict_price_confidence_range():
    """min_price <= estimated_price <= max_price."""
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
    """When ML_API_KEY is set and correct header is provided — expect 200."""
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
    assert response.status_code == 200


# ---------------------------------------------------------------------------
# Training endpoint
# ---------------------------------------------------------------------------

def test_train_price():
    """POST /train/price — returns success with r2/mae/rmse metrics."""
    response = client.post("/train/price")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "metrics" in data
    assert "r2" in data["metrics"]
    assert "mae" in data["metrics"]
    assert "rmse" in data["metrics"]
