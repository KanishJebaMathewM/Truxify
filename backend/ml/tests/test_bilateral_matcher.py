import os
import sys
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from main import app

client = TestClient(app)


def bilateral_payload():
    return {
        "loads": [
            {
                "origin_lat": 19.076,
                "origin_lng": 72.877,
                "dest_lat": 28.614,
                "dest_lng": 77.209,
                "weight_kg": 5000,
                "length_m": 4.0,
                "width_m": 2.0,
                "height_m": 2.0,
                "deadline_hours": 48,
            },
            {
                "origin_lat": 12.971,
                "origin_lng": 77.594,
                "dest_lat": 17.385,
                "dest_lng": 78.486,
                "weight_kg": 3000,
                "length_m": 3.0,
                "width_m": 2.0,
                "height_m": 1.5,
                "deadline_hours": 24,
            },
        ],
        "drivers": [
            {
                "current_lat": 19.0,
                "current_lng": 72.8,
                "max_weight_kg": 10000,
                "max_length_m": 6.0,
                "max_width_m": 2.5,
                "max_height_m": 2.5,
                "preferred_dest_lat": 28.0,
                "preferred_dest_lng": 77.0,
                "rating": 4.5,
            },
            {
                "current_lat": 13.0,
                "current_lng": 77.5,
                "max_weight_kg": 8000,
                "max_length_m": 5.0,
                "max_width_m": 2.5,
                "max_height_m": 2.5,
                "preferred_dest_lat": 17.0,
                "preferred_dest_lng": 78.0,
                "rating": 4.0,
            },
        ],
    }


def test_bilateral_match_valid():
    response = client.post("/match/bilateral", json=bilateral_payload())
    assert response.status_code == 200
    data = response.json()
    assert "assignments" in data
    assert "unmatched_loads" in data
    assert "unmatched_drivers" in data
    assert isinstance(data["assignments"], list)


def test_bilateral_match_empty_loads():
    payload = bilateral_payload()
    payload["loads"] = []
    response = client.post("/match/bilateral", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert len(data["assignments"]) == 0
    assert len(data["unmatched_drivers"]) == 2


def test_bilateral_match_empty_drivers():
    payload = bilateral_payload()
    payload["drivers"] = []
    response = client.post("/match/bilateral", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert len(data["assignments"]) == 0
    assert len(data["unmatched_loads"]) == 2


def test_bilateral_match_single_pair():
    payload = bilateral_payload()
    payload["loads"] = payload["loads"][:1]
    payload["drivers"] = payload["drivers"][:1]
    response = client.post("/match/bilateral", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert len(data["assignments"]) == 1


def test_bilateral_match_auth_missing(monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "test-secret-key")
    response = client.post("/match/bilateral", json=bilateral_payload())
    assert response.status_code == 401


def test_bilateral_match_auth_valid(monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "test-secret-key")
    response = client.post(
        "/match/bilateral",
        json=bilateral_payload(),
        headers={"X-API-Key": "test-secret-key"},
    )
    assert response.status_code == 200
