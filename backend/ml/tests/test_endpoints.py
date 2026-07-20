import os
import shutil
import pytest
from fastapi.testclient import TestClient

# Adjust python path if necessary to import app
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from main import app
from app.models.base import MODEL_STORAGE_DIR

client = TestClient(app)


def test_root():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"message": "Truxify ML Engine is running"}


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in {"healthy", "degraded"}
    assert data["service"] == "ml-engine"
    assert set(data["models"]) == {
        "demand_forecast",
        "price_forecast",
        "driver_profit",
        "trust_scorer",
        "collaborative_filter",
        "eta_predictor",
        "traffic_eta",
    }


def _auth_payload():
    return {
        "hour": 15.5,
        "day_of_week": 4.0,
        "temperature": 28.0,
        "precipitation": 0.0,
        "historical_volume": 35.0,
        "nearby_drivers": 10.0
    }


def test_auth_missing_key(monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "test-secret-key")
    response = client.post("/predict/demand", json=_auth_payload())
    assert response.status_code == 401
    assert response.json() == {"detail": "Unauthorized"}


def test_auth_invalid_key(monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "test-secret-key")
    response = client.post("/predict/demand", json=_auth_payload(), headers={"X-API-Key": "wrong-key"})
    assert response.status_code == 401
    assert response.json() == {"detail": "Unauthorized"}


def test_auth_valid_key(monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "test-secret-key")
    response = client.post("/predict/demand", json=_auth_payload(), headers={"X-API-Key": "test-secret-key"})
    assert response.status_code == 200


def test_auth_dev_mode_bypass(monkeypatch):
    monkeypatch.delenv("ML_API_KEY", raising=False)
    response = client.post("/predict/demand", json=_auth_payload())
    assert response.status_code == 503


def test_health_no_auth_required(monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "test-secret-key")
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["service"] == "ml-engine"


def test_train_demand():
    response = client.post("/train/demand")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "metrics" in data
    assert "r2" in data["metrics"]
    assert "mae" in data["metrics"]
    assert "rmse" in data["metrics"]


def test_list_models():
    response = client.get("/models")
    assert response.status_code == 200
    data = response.json()
    assert "models" in data
    assert isinstance(data["models"], list)
    # Ensure our trained model is listed
    model_names = [m["model_name"] for m in data["models"]]
    assert "demand_forecast" in model_names


def test_predict_demand_valid():
    payload = {
        "hour": 15.5,
        "day_of_week": 4.0,
        "temperature": 28.0,
        "precipitation": 0.0,
        "historical_volume": 35.0,
        "nearby_drivers": 10.0
    }
    response = client.post("/predict/demand", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "predicted_demand" in data
    assert isinstance(data["predicted_demand"], float)
    assert data["predicted_demand"] >= 0
    assert data["model_version"] == "1.0.0"


def test_predict_price_valid():
    payload = {
        "distance_km": 500.0,
        "cargo_weight_kg": 10000.0,
        "truck_type": "heavy_truck",
        "route_origin": "Mumbai",
        "route_destination": "Delhi",
    }
    response = client.post("/predict/price", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "estimated_price" in data
    assert isinstance(data["estimated_price"], float)
    assert data["estimated_price"] > 0
    assert data["currency"] == "INR"


def test_predict_price_minimal():
    payload = {
        "distance_km": 100.0,
        "cargo_weight_kg": 1000.0,
    }
    response = client.post("/predict/price", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["estimated_price"] > 0


def test_predict_price_invalid_distance():
    payload = {
        "distance_km": 0,
        "cargo_weight_kg": 1000.0,
    }
    response = client.post("/predict/price", json=payload)
    assert response.status_code == 422


def test_predict_demand_invalid_fields():
    # hour out of bounds (0-23)
    payload = {
        "hour": 25.0,
        "day_of_week": 4.0,
        "temperature": 28.0,
        "precipitation": 0.0,
        "historical_volume": 35.0,
        "nearby_drivers": 10.0
    }
    response = client.post("/predict/demand", json=payload)
    assert response.status_code == 422
