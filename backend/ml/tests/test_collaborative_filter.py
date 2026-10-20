import os
import sys
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from main import app
from app.models.collaborative_filter import collaborative_filter

client = TestClient(app, headers={'X-API-Key': 'test_key'})


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


def test_cold_start_excludes_booked_load():
    collaborative_filter._ensure_loaded()
    popular_load_id = collaborative_filter.load_ids[int(collaborative_filter._popular_loads[0])]

    result = collaborative_filter.recommend_loads(
        user_id="unknown_user",
        booking_history=[{"load_id": popular_load_id}],
        top_n=5,
    )

    recommended_ids = {item["load_id"] for item in result["recommendations"]}
    assert popular_load_id not in recommended_ids


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
