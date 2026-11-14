
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Ensure the application module is importable.
sys.path.insert(0, str(Path(__file__).parent))

from app import app


@pytest.fixture(scope="module")
def client():
    """Create a reusable FastAPI test client."""
    with TestClient(app) as test_client:
        yield test_client


# ==========================================
# Health Endpoint Tests
# ==========================================

def test_health_endpoint(client):
    response = client.get("/health")

    assert response.status_code == 200

    data = response.json()

    assert isinstance(data, dict)
    assert data.get("status") == "ok"
    assert isinstance(data.get("models_loaded"), int)
    assert data["models_loaded"] >= 4


def test_health_endpoint_response_structure(client):
    response = client.get("/health")

    assert response.status_code == 200

    data = response.json()

    assert "status" in data
    assert "models_loaded" in data


# ==========================================
# Deadhead Load Router Tests
# ==========================================

@pytest.mark.parametrize(
    "driver_id, latitude, longitude",
    [
        ("driver_101", 13.0827, 80.2707),
        ("driver_102", 12.9716, 77.5946),
        ("driver_103", 19.0760, 72.8777),
    ],
)
def test_deadhead_router_mounted(
    client,
    driver_id,
    latitude,
    longitude,
):
    response = client.get(
        "/ml/en-route-loads",
        params={
            "driverId": driver_id,
            "currentLat": latitude,
            "currentLng": longitude,
        },
    )

    assert response.status_code == 200

    data = response.json()

    assert data.get("success") is True
    assert data.get("driverId") == driver_id
    assert isinstance(data.get("loads"), list)
    assert len(data["loads"]) >= 1


def test_deadhead_load_response_structure(client):
    response = client.get(
        "/ml/en-route-loads",
        params={
            "driverId": "driver_101",
            "currentLat": 13.0827,
            "currentLng": 80.2707,
        },
    )

    assert response.status_code == 200

    data = response.json()

    assert "success" in data
    assert "driverId" in data
    assert "loads" in data

    for load in data["loads"]:
        assert isinstance(load, dict)


# ==========================================
# Input Validation Tests
# ==========================================

@pytest.mark.parametrize(
    "params",
    [
        {"currentLat": 13.0827, "currentLng": 80.2707},
        {"driverId": "driver_101", "currentLng": 80.2707},
        {"driverId": "driver_101", "currentLat": 13.0827},
    ],
)
def test_deadhead_missing_parameters(client, params):
    response = client.get("/ml/en-route-loads", params=params)

    assert response.status_code == 422


@pytest.mark.parametrize(
    "latitude, longitude",
    [
        (91, 80.2707),
        (-91, 80.2707),
        (13.0827, 181),
        (13.0827, -181),
    ],
)
def test_deadhead_invalid_coordinates(client, latitude, longitude):
    response = client.get(
        "/ml/en-route-loads",
        params={
            "driverId": "driver_101",
            "currentLat": latitude,
            "currentLng": longitude,
        },
    )

    assert response.status_code == 422
