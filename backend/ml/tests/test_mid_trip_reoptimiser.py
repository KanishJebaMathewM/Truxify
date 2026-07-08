import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from main import app

client = TestClient(app)


def _valid_payload():
    """Return a reusable valid mid-trip payload."""
    return {
        "current_location": {"lat": 19.076, "lng": 72.877},
        "remaining_route": [
            {"lat": 20.0, "lng": 73.0},
            {"lat": 21.0, "lng": 73.5},
        ],
        "available_capacity": {
            "weight_kg": 5000,
            "length_m": 3.0,
            "width_m": 2.0,
            "height_m": 2.0,
        },
        "nearby_loads": [
            {
                "load_id": "NL001",
                "pickup_lat": 19.2,
                "pickup_lng": 72.9,
                "dropoff_lat": 20.5,
                "dropoff_lng": 73.2,
                "weight_kg": 1000,
                "length_m": 1.0,
                "width_m": 1.0,
                "height_m": 1.0,
                "payment_inr": 5000,
                "pickup_deadline": "2026-06-28T15:00:00",
            },
            {
                "load_id": "NL002",
                "pickup_lat": 19.3,
                "pickup_lng": 73.0,
                "dropoff_lat": 20.8,
                "dropoff_lng": 73.4,
                "weight_kg": 2000,
                "length_m": 2.0,
                "width_m": 1.5,
                "height_m": 1.0,
                "payment_inr": 8000,
                "pickup_deadline": "2026-06-28T16:00:00",
            },
        ],
    }


# ---------------------------------------------------------------------------
# Valid prediction tests
# ---------------------------------------------------------------------------

def test_mid_trip_valid():
    """Full payload — 200 with recommendations containing expected fields."""
    payload = _valid_payload()
    response = client.post("/optimise/mid-trip", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "recommendations" in data
    assert isinstance(data["recommendations"], list)
    for rec in data["recommendations"]:
        assert "load_id" in rec
        assert "detour_km" in rec
        assert "detour_minutes" in rec
        assert "additional_earnings" in rec
        assert "priority_score" in rec
        assert "pickup_location" in rec
        assert "dropoff_location" in rec


def test_mid_trip_empty_loads():
    """Empty nearby_loads list — 200 with empty recommendations."""
    payload = _valid_payload()
    payload["nearby_loads"] = []
    response = client.post("/optimise/mid-trip", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["recommendations"] == []


def test_mid_trip_overweight_load():
    """Load exceeding available capacity weight should not appear."""
    payload = _valid_payload()
    # Replace loads with a single overweight load
    payload["nearby_loads"] = [
        {
            "load_id": "NL_HEAVY",
            "pickup_lat": 19.2,
            "pickup_lng": 72.9,
            "dropoff_lat": 20.5,
            "dropoff_lng": 73.2,
            "weight_kg": 10000,
            "length_m": 1.0,
            "width_m": 1.0,
            "height_m": 1.0,
            "payment_inr": 20000,
            "pickup_deadline": "2026-06-28T15:00:00",
        }
    ]
    response = client.post("/optimise/mid-trip", json=payload)
    assert response.status_code == 200
    data = response.json()
    recommended_ids = [r["load_id"] for r in data["recommendations"]]
    assert "NL_HEAVY" not in recommended_ids


def test_mid_trip_no_route():
    """Empty remaining_route — should still return 200."""
    payload = _valid_payload()
    payload["remaining_route"] = []
    response = client.post("/optimise/mid-trip", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "recommendations" in data


# ---------------------------------------------------------------------------
# API key auth tests
# ---------------------------------------------------------------------------

def test_mid_trip_auth_missing(monkeypatch):
    """When ML_API_KEY is set but no header is sent — expect 401."""
    monkeypatch.setenv("ML_API_KEY", "test-secret-key")
    payload = _valid_payload()
    response = client.post("/optimise/mid-trip", json=payload)
    assert response.status_code == 401
    assert response.json() == {"detail": "Unauthorized"}


def test_mid_trip_auth_valid(monkeypatch):
    """When ML_API_KEY is set and correct header is provided — expect 200."""
    monkeypatch.setenv("ML_API_KEY", "test-secret-key")
    payload = _valid_payload()
    response = client.post(
        "/optimise/mid-trip",
        json=payload,
        headers={"X-API-Key": "test-secret-key"},
    )
    assert response.status_code == 200
