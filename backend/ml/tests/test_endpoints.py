import os
import shutil
import pytest
from fastapi.testclient import TestClient

# Adjust python path if necessary to import app
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from main import app
from app.models.base import MODEL_STORAGE_DIR
from app.models import price_prediction as pp

client = TestClient(app, headers={'X-API-Key': 'test_key'})


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


def test_predict_price_valid(monkeypatch):
    """Price model is gated: without a real-data model the endpoint is 503."""
    monkeypatch.setattr(pp, "get_model_meta", lambda name: None)
    payload = {
        "distance_km": 500.0,
        "cargo_weight_kg": 10000.0,
        "truck_type": "heavy_truck",
        "route_origin": "Mumbai",
        "route_destination": "Delhi",
    }
    response = client.post("/predict/price", json=payload)
    assert response.status_code == 503


def test_predict_price_minimal(monkeypatch):
    """Backward-compat payload still gated at 503 without a real model."""
    monkeypatch.setattr(pp, "get_model_meta", lambda name: None)
    payload = {
        "distance_km": 100.0,
        "cargo_weight_kg": 1000.0,
    }
    response = client.post("/predict/price", json=payload)
    assert response.status_code == 503


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


def test_cpu_bound_inference_runs_once_per_request(monkeypatch):
    """Regression guard for #10144: demand/packing/deadhead/mid-trip must run
    the CPU-bound scorer exactly once — never twice via a second
    asyncio.to_thread call that discards the run_inference result."""
    import main as main_module

    calls = []

    async def fake_run_inference(func, *args, **kwargs):
        calls.append(func.__name__)
        if func is main_module.predict_demand:
            return 10.0
        if func is main_module.optimise_packing:
            return {
                "packing_arrangement": [],
                "unpacked_packages": [],
                "stop_sequence": [0],
                "utilization_pct": 50.0,
            }
        return {"recommendations": []}

    async def fail_to_thread(*args, **kwargs):
        raise AssertionError(
            "asyncio.to_thread must not be called by endpoint inference"
        )

    monkeypatch.setattr(main_module, "run_inference", fake_run_inference)
    monkeypatch.setattr(main_module.asyncio, "to_thread", fail_to_thread)

    demand_payload = _auth_payload()
    response = client.post("/predict/demand", json=demand_payload)
    assert response.status_code == 200
    assert calls == ["predict_demand"]
    calls.clear()

    packing_payload = {
        "packages": [{"length": 1.0, "width": 1.0, "height": 1.0, "weight": 5.0}],
        "truck": {"length": 10.0, "width": 5.0, "height": 5.0, "max_weight": 1000.0},
        "delivery_addresses": [{"lat": 19.07, "lng": 72.87}],
    }
    response = client.post("/optimise/packing", json=packing_payload)
    assert response.status_code == 200
    assert calls == ["optimise_packing"]
    calls.clear()

    deadhead_payload = {
        "driver_destination": {"lat": 19.07, "lng": 72.87},
        "truck_specs": {
            "max_weight_kg": 10000.0,
            "max_length_m": 20.0,
            "max_width_m": 8.0,
            "max_height_m": 8.0,
        },
        "arrival_time": "2026-08-11T10:00:00Z",
        "available_loads": [
            {
                "load_id": "L1",
                "origin_lat": 19.0,
                "origin_lng": 72.0,
                "dest_lat": 20.0,
                "dest_lng": 73.0,
                "weight_kg": 5000.0,
                "length_m": 10.0,
                "width_m": 5.0,
                "height_m": 5.0,
                "pickup_deadline": "2026-08-11T10:00:00Z",
                "payment_inr": 10000.0,
            }
        ],
    }
    response = client.post("/match/deadhead", json=deadhead_payload)
    assert response.status_code == 200
    assert calls == ["find_return_loads"]
    calls.clear()

    mid_trip_payload = {
        "current_location": {"lat": 19.07, "lng": 72.87},
        "remaining_route": [{"lat": 19.0, "lng": 72.0}],
        "available_capacity": {
            "weight_kg": 5000.0,
            "length_m": 10.0,
            "width_m": 5.0,
            "height_m": 5.0,
        },
        "nearby_loads": [
            {
                "load_id": "L1",
                "pickup_lat": 19.0,
                "pickup_lng": 72.0,
                "dropoff_lat": 20.0,
                "dropoff_lng": 73.0,
                "weight_kg": 5000.0,
                "length_m": 10.0,
                "width_m": 5.0,
                "height_m": 5.0,
                "payment_inr": 10000.0,
                "pickup_deadline": "2026-08-11T10:00:00Z",
            }
        ],
    }
    response = client.post("/optimise/mid-trip", json=mid_trip_payload)
    assert response.status_code == 200
    assert calls == ["find_mid_trip_loads"]
