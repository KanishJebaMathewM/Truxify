import os
import sys
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from app.main import app

client = TestClient(app)


def recommend_loads_payload():
    return {
        "user_id": "user_001",
        "booking_history": [{"load_id": "L1", "rating": 4}],
        "rated_drivers": [{"driver_id": "D1", "rating": 5}],
        "top_n": 3,
    }


def recommend_trucks_payload():
    return {
        "user_id": "user_001",
        "booking_history": [{"truck_id": "T1", "rating": 4}],
        "rated_loads": [{"load_id": "L1", "rating": 5}],
        "top_n": 3,
    }


def test_recommend_loads_valid():
    response = client.post("/recommend/loads", json=recommend_loads_payload())
    assert response.status_code == 200
    data = response.json()
    assert "recommendations" in data
    assert isinstance(data["recommendations"], list)


def test_recommend_trucks_valid():
    response = client.post("/recommend/trucks", json=recommend_trucks_payload())
    assert response.status_code == 200
    data = response.json()
    assert "recommendations" in data
    assert isinstance(data["recommendations"], list)


def test_recommend_loads_unknown_user():
    payload = recommend_loads_payload()
    payload["user_id"] = "unknown_user"
    payload["booking_history"] = []
    payload["rated_drivers"] = []
    response = client.post("/recommend/loads", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "recommendations" in data
    assert isinstance(data["recommendations"], list)


def test_recommend_loads_auth_missing(monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "test-secret-key")
    response = client.post("/recommend/loads", json=recommend_loads_payload())
    assert response.status_code == 401


def test_recommend_loads_auth_valid(monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "test-secret-key")
    response = client.post(
        "/recommend/loads",
        json=recommend_loads_payload(),
        headers={"X-API-Key": "test-secret-key"},
    )
    assert response.status_code == 200


def test_recommend_trucks_auth_missing(monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "test-secret-key")
    response = client.post("/recommend/trucks", json=recommend_trucks_payload())
    assert response.status_code == 401
