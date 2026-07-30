import os
import sys
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from main import app

client = TestClient(app, headers={'X-API-Key': 'test_key'})


def profit_payload():
    return {
        "route_distance": 500.0,
        "fuel_price": 105.0,
        "toll_estimate": 1500.0,
        "truck_mileage": 5.0,
        "cargo_weight": 10000.0,
        "trip_duration": 12.0,
    }


def test_driver_profit_valid():
    response = client.post("/predict/driver-profit", json=profit_payload())
    assert response.status_code == 200
    data = response.json()
    assert "predicted_profit" in data
    assert "confidence_interval" in data
    assert isinstance(data["predicted_profit"], float)
    assert "lower" in data["confidence_interval"]
    assert "upper" in data["confidence_interval"]


def test_driver_profit_short_distance():
    payload = profit_payload()
    payload["route_distance"] = 50.0
    response = client.post("/predict/driver-profit", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "predicted_profit" in data


def test_driver_profit_invalid_zero_distance():
    payload = profit_payload()
    payload["route_distance"] = 0
    response = client.post("/predict/driver-profit", json=payload)
    assert response.status_code == 422


def test_driver_profit_invalid_zero_mileage():
    payload = profit_payload()
    payload["truck_mileage"] = 0
    response = client.post("/predict/driver-profit", json=payload)
    assert response.status_code == 422


def test_driver_profit_auth_missing(monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "test-secret-key")
    response = client.post("/predict/driver-profit", json=profit_payload())
    assert response.status_code == 401


def test_driver_profit_auth_valid(monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "test-secret-key")
    response = client.post(
        "/predict/driver-profit",
        json=profit_payload(),
        headers={"X-API-Key": "test-secret-key"},
    )
    assert response.status_code == 200
