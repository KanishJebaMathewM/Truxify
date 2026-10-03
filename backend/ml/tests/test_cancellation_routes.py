import os
import sys

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from main import app


client = TestClient(app, headers={"X-API-Key": "test_key"})


def test_cancellation_penalty_returns_proportional_amount(monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "test_key")

    response = client.post(
        "/cancellation-penalty",
        json={
            "distance_covered_km": 25,
            "total_distance_km": 100,
            "total_amount": 1200,
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "distance_covered_km": 25.0,
        "total_distance_km": 100.0,
        "covered_ratio": 0.25,
        "penalty_amount": 300.0,
    }


def test_cancellation_penalty_caps_covered_distance_at_full_trip(monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "test_key")

    response = client.post(
        "/cancellation-penalty",
        json={
            "distance_covered_km": 125,
            "total_distance_km": 100,
            "total_amount": 999.99,
        },
    )

    assert response.status_code == 200
    assert response.json()["covered_ratio"] == 1.0
    assert response.json()["penalty_amount"] == 999.99


def test_cancellation_penalty_rejects_invalid_distances(monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "test_key")

    response = client.post(
        "/cancellation-penalty",
        json={
            "distance_covered_km": -1,
            "total_distance_km": 0,
            "total_amount": 100,
        },
    )

    assert response.status_code == 422


def test_cancellation_penalty_requires_api_key(monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "test_key")

    response = TestClient(app).post(
        "/cancellation-penalty",
        json={
            "distance_covered_km": 10,
            "total_distance_km": 100,
            "total_amount": 100,
        },
    )

    assert response.status_code == 401
