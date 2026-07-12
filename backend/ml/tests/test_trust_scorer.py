import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from main import app

client = TestClient(app, headers={'X-API-Key': 'test_key'})


# ---------------------------------------------------------------------------
# Valid prediction tests
# ---------------------------------------------------------------------------

def test_trust_score_valid():
    """Standard payload — 200 with trust_score 0-100 and valid risk_category."""
    payload = {
        "cancellation_rate": 0.05,
        "on_time_pct": 95.0,
        "avg_rating": 4.5,
        "dispute_count": 1,
        "is_verified": True,
    }
    response = client.post("/score/trust", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "trust_score" in data
    assert isinstance(data["trust_score"], float)
    assert 0 <= data["trust_score"] <= 100
    assert "risk_category" in data
    assert data["risk_category"] in ["Low", "Medium", "High"]


def test_trust_score_high_risk():
    """Poor stats should yield a High or Medium risk category."""
    payload = {
        "cancellation_rate": 0.45,
        "on_time_pct": 55.0,
        "avg_rating": 2.0,
        "dispute_count": 15,
        "is_verified": False,
    }
    response = client.post("/score/trust", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["risk_category"] in ["High", "Medium"]


def test_trust_score_low_risk():
    """Excellent stats should yield Low risk or a high trust score."""
    payload = {
        "cancellation_rate": 0.01,
        "on_time_pct": 99.0,
        "avg_rating": 4.9,
        "dispute_count": 0,
        "is_verified": True,
    }
    response = client.post("/score/trust", json=payload)
    assert response.status_code == 200
    data = response.json()
    # Either Low risk or high score indicates correct behaviour
    assert data["risk_category"] == "Low" or data["trust_score"] >= 70


# ---------------------------------------------------------------------------
# Input validation tests (422)
# ---------------------------------------------------------------------------

def test_trust_score_invalid_cancellation_rate():
    """cancellation_rate=1.5 exceeds le=1 — expect 422."""
    payload = {
        "cancellation_rate": 1.5,
        "on_time_pct": 95.0,
        "avg_rating": 4.5,
        "dispute_count": 1,
        "is_verified": True,
    }
    response = client.post("/score/trust", json=payload)
    assert response.status_code == 422


def test_trust_score_invalid_rating():
    """avg_rating=6 exceeds le=5 — expect 422."""
    payload = {
        "cancellation_rate": 0.05,
        "on_time_pct": 95.0,
        "avg_rating": 6,
        "dispute_count": 1,
        "is_verified": True,
    }
    response = client.post("/score/trust", json=payload)
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# API key auth tests
# ---------------------------------------------------------------------------

def test_trust_score_auth_missing(monkeypatch):
    """When ML_API_KEY is set but no header is sent — expect 401."""
    monkeypatch.setenv("ML_API_KEY", "test-secret-key")
    payload = {
        "cancellation_rate": 0.05,
        "on_time_pct": 95.0,
        "avg_rating": 4.5,
        "dispute_count": 1,
        "is_verified": True,
    }
    response = client.post("/score/trust", json=payload)
    assert response.status_code == 401
    assert response.json() == {"detail": "Unauthorized"}


def test_trust_score_auth_valid(monkeypatch):
    """When ML_API_KEY is set and correct header is provided — expect 200."""
    monkeypatch.setenv("ML_API_KEY", "test-secret-key")
    payload = {
        "cancellation_rate": 0.05,
        "on_time_pct": 95.0,
        "avg_rating": 4.5,
        "dispute_count": 1,
        "is_verified": True,
    }
    response = client.post(
        "/score/trust",
        json=payload,
        headers={"X-API-Key": "test-secret-key"},
    )
    assert response.status_code == 200
