import sys
from pathlib import Path
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent))
from app import app


def test_health_endpoint():
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["models_loaded"] == 4


def test_deadhead_router_mounted():
    client = TestClient(app)
    response = client.get("/ml/en-route-loads", params={
        "driverId": "driver_101",
        "currentLat": 13.0827,
        "currentLng": 80.2707,
    })
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["driverId"] == "driver_101"
    assert len(data["loads"]) >= 1
