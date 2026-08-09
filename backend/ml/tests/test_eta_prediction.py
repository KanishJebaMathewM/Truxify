import os
import sys
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from main import app

client = TestClient(app, headers={'X-API-Key': 'test_key'})


def eta_payload():
    return {
        "route_distance": 250.0,
        "time_of_day": 10,
        "day_of_week": 2,
        "route_type": "highway",
        "historical_speed": 65.0,
    }


def test_predict_eta_valid():
    response = client.post("/predict/eta", json=eta_payload())

    assert response.status_code == 200
    data = response.json()

    assert "eta_minutes" in data
    assert "confidence_interval" in data
    assert isinstance(data["eta_minutes"], float)
    assert data["eta_minutes"] > 0
    assert "min" in data["confidence_interval"]
    assert "max" in data["confidence_interval"]


def test_predict_eta_city_route():
    payload = eta_payload()
    payload["route_type"] = "city"
    payload["historical_speed"] = 35.0

    response = client.post("/predict/eta", json=payload)

    assert response.status_code == 200
    data = response.json()
    assert data["eta_minutes"] > 0


def test_predict_eta_invalid_distance():
    payload = eta_payload()
    payload["route_distance"] = 0

    response = client.post("/predict/eta", json=payload)

    assert response.status_code == 422


def test_predict_eta_invalid_time_of_day():
    payload = eta_payload()
    payload["time_of_day"] = 25

    response = client.post("/predict/eta", json=payload)

    assert response.status_code == 422


def test_predict_eta_invalid_day_of_week():
    payload = eta_payload()
    payload["day_of_week"] = 8

    response = client.post("/predict/eta", json=payload)

    assert response.status_code == 422


def test_predict_eta_invalid_speed():
    payload = eta_payload()
    payload["historical_speed"] = 0

    response = client.post("/predict/eta", json=payload)

    assert response.status_code == 422


def test_predict_eta_auth_missing_key(monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "test-secret-key")

    response = client.post("/predict/eta", json=eta_payload())

    assert response.status_code == 401
    assert response.json() == {"detail": "Unauthorized"}


def test_predict_eta_auth_valid_key(monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "test-secret-key")

    response = client.post(
        "/predict/eta",
        json=eta_payload(),
        headers={"X-API-Key": "test-secret-key"},
    )

    assert response.status_code == 200


def test_predict_eta_auth_invalid_key(monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "test-secret-key")

    response = client.post(
        "/predict/eta",
        json=eta_payload(),
        headers={"X-API-Key": "wrong-key"},
    )

    assert response.status_code == 401
