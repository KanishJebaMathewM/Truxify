import os
import sys
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from main import app

client = TestClient(app, headers={'X-API-Key': 'test_key'})


def packing_payload():
    return {
        "packages": [
            {"length": 1.0, "width": 1.0, "height": 1.0, "weight": 100.0},
            {"length": 0.5, "width": 0.5, "height": 0.5, "weight": 50.0},
        ],
        "truck": {"length": 6.0, "width": 2.5, "height": 2.5, "max_weight": 10000.0},
        "delivery_addresses": [
            {"lat": 19.076, "lng": 72.877},
            {"lat": 28.614, "lng": 77.209},
        ],
    }


def test_packing_valid():
    response = client.post("/optimise/packing", json=packing_payload())
    assert response.status_code == 200
    data = response.json()
    assert "packing_arrangement" in data
    assert "unpacked_packages" in data
    assert "stop_sequence" in data
    assert "utilization_pct" in data


def test_packing_single_package():
    payload = packing_payload()
    payload["packages"] = payload["packages"][:1]
    payload["delivery_addresses"] = payload["delivery_addresses"][:1]
    response = client.post("/optimise/packing", json=payload)
    assert response.status_code == 200


def test_packing_oversized_package():
    payload = packing_payload()
    # Add an oversized package
    payload["packages"].append(
        {"length": 10.0, "width": 3.0, "height": 3.0, "weight": 500.0}
    )
    payload["delivery_addresses"].append({"lat": 12.971, "lng": 77.594})
    response = client.post("/optimise/packing", json=payload)
    assert response.status_code == 200
    data = response.json()
    # The oversized package should be unpacked because it exceeds truck dimensions
    assert len(data["unpacked_packages"]) > 0


def test_packing_invalid_zero_dimension():
    payload = packing_payload()
    payload["packages"][0]["length"] = 0
    response = client.post("/optimise/packing", json=payload)
    assert response.status_code == 422


def test_packing_auth_missing(monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "test-secret-key")
    response = client.post("/optimise/packing", json=packing_payload())
    assert response.status_code == 401


def test_packing_auth_valid(monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "test-secret-key")
    response = client.post(
        "/optimise/packing",
        json=packing_payload(),
        headers={"X-API-Key": "test-secret-key"},
    )
    assert response.status_code == 200
