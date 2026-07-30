import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from main import app

client = TestClient(app, headers={'X-API-Key': 'test_key'})


def _valid_payload():
    """Return a reusable valid deadhead payload."""
    return {
        "driver_destination": {"lat": 19.076, "lng": 72.877},
        "truck_specs": {
            "max_weight_kg": 10000,
            "max_length_m": 6.0,
            "max_width_m": 2.5,
            "max_height_m": 2.5,
        },
        "arrival_time": "2026-06-28T10:00:00",
        "available_loads": [
            {
                "load_id": "L001",
                "origin_lat": 19.1,
                "origin_lng": 72.9,
                "dest_lat": 18.52,
                "dest_lng": 73.85,
                "weight_kg": 5000,
                "length_m": 3.0,
                "width_m": 2.0,
                "height_m": 1.5,
                "pickup_deadline": "2026-06-28T14:00:00",
                "payment_inr": 15000,
            },
            {
                "load_id": "L002",
                "origin_lat": 19.2,
                "origin_lng": 73.0,
                "dest_lat": 20.0,
                "dest_lng": 73.8,
                "weight_kg": 3000,
                "length_m": 2.0,
                "width_m": 1.5,
                "height_m": 1.0,
                "pickup_deadline": "2026-06-28T16:00:00",
                "payment_inr": 12000,
            },
        ],
    }


# ---------------------------------------------------------------------------
# Valid prediction tests
# ---------------------------------------------------------------------------

def test_deadhead_valid():
    """Full payload — 200 with recommendations containing expected fields."""
    payload = _valid_payload()
    response = client.post("/match/deadhead", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "recommendations" in data
    assert isinstance(data["recommendations"], list)
    for rec in data["recommendations"]:
        assert "load_id" in rec
        assert "distance_to_pickup_km" in rec
        assert "match_score" in rec
        assert "detour_km" in rec
        assert "estimated_earnings" in rec


def test_deadhead_empty_loads():
    """Empty available_loads list — 200 with empty recommendations."""
    payload = _valid_payload()
    payload["available_loads"] = []
    response = client.post("/match/deadhead", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["recommendations"] == []


def test_deadhead_oversized_load():
    """Load exceeding truck max_weight_kg should not appear in recommendations."""
    payload = _valid_payload()
    # Replace loads with a single oversized load
    payload["available_loads"] = [
        {
            "load_id": "L_HEAVY",
            "origin_lat": 19.1,
            "origin_lng": 72.9,
            "dest_lat": 18.52,
            "dest_lng": 73.85,
            "weight_kg": 20000,
            "length_m": 3.0,
            "width_m": 2.0,
            "height_m": 1.5,
            "pickup_deadline": "2026-06-28T14:00:00",
            "payment_inr": 25000,
        }
    ]
    response = client.post("/match/deadhead", json=payload)
    assert response.status_code == 200
    data = response.json()
    recommended_ids = [r["load_id"] for r in data["recommendations"]]
    assert "L_HEAVY" not in recommended_ids


# ---------------------------------------------------------------------------
# API key auth tests
# ---------------------------------------------------------------------------

def test_deadhead_auth_missing(monkeypatch):
    """When ML_API_KEY is set but no header is sent — expect 401."""
    monkeypatch.setenv("ML_API_KEY", "test-secret-key")
    payload = _valid_payload()
    response = client.post("/match/deadhead", json=payload)
    assert response.status_code == 401
    assert response.json() == {"detail": "Unauthorized"}


def test_deadhead_auth_valid(monkeypatch):
    """When ML_API_KEY is set and correct header is provided — expect 200."""
    monkeypatch.setenv("ML_API_KEY", "test-secret-key")
    payload = _valid_payload()
    response = client.post(
        "/match/deadhead",
        json=payload,
        headers={"X-API-Key": "test-secret-key"},
    )
    assert response.status_code == 200
