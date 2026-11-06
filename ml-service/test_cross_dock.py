from fastapi.testclient import TestClient
from app import app

client = TestClient(app)


def test_estimate_cross_dock_palletized():
    res = client.post(
        "/ml/cross-dock-estimate",
        json={
            "unit_count": 20,
            "packaging_type": "palletized",
            "forklifts_available": 2,
            "congestion_index": 1.0,
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    # 20 * 2.5 min = 50 min / 2 forklifts = 25 min handling
    assert data["handling_minutes"] == 25.0
    # buffer = 25 * 0.15 = 3.8
    assert data["safety_buffer_minutes"] == 3.8
    assert data["recommended_turnaround_minutes"] == 28.8
    assert data["recommended_labor_count"] >= 2


def test_estimate_cross_dock_congested():
    res = client.post(
        "/ml/cross-dock-estimate",
        json={
            "unit_count": 10,
            "packaging_type": "loose_cartons",
            "forklifts_available": 1,
            "congestion_index": 2.0,
        },
    )
    assert res.status_code == 200
    data = res.json()
    # 10 * 5.0 = 50 min * 2.0 congestion = 100 min
    assert data["handling_minutes"] == 100.0


def test_estimate_cross_dock_validation_error():
    res = client.post(
        "/ml/cross-dock-estimate",
        json={
            "unit_count": 0,
            "packaging_type": "palletized",
            "forklifts_available": 1,
        },
    )
    assert res.status_code == 422
