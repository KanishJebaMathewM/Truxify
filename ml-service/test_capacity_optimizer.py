from fastapi.testclient import TestClient
from app import app

client = TestClient(app)


def test_optimize_payload_empty_items():
    res = client.post(
        "/ml/optimize-payload",
        json={"max_weight_kg": 1000.0, "max_volume_m3": 20.0, "items": []},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["selected_items"] == []
    assert data["total_revenue"] == 0.0


def test_optimize_payload_knapsack_selection():
    items = [
        {"item_id": "pkg_1", "weight_kg": 500.0, "volume_m3": 5.0, "revenue": 1000.0},
        {"item_id": "pkg_2", "weight_kg": 400.0, "volume_m3": 4.0, "revenue": 1200.0},
        {"item_id": "pkg_3", "weight_kg": 300.0, "volume_m3": 3.0, "revenue": 800.0},
    ]
    res = client.post(
        "/ml/optimize-payload",
        json={"max_weight_kg": 800.0, "max_volume_m3": 10.0, "items": items},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    # pkg_2 and pkg_3 fit (700kg <= 800kg, 7m3 <= 10m3, revenue 2000)
    assert len(data["selected_items"]) >= 1
    assert data["total_weight_kg"] <= 800.0
    assert data["total_volume_m3"] <= 10.0
    assert data["weight_utilization_percent"] > 0
    assert data["volume_utilization_percent"] > 0


def test_optimize_payload_validation_negative_capacity():
    res = client.post(
        "/ml/optimize-payload",
        json={"max_weight_kg": -100.0, "max_volume_m3": 20.0, "items": []},
    )
    assert res.status_code == 422
