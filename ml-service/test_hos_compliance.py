from fastapi.testclient import TestClient
from app import app

client = TestClient(app)


def test_generate_hos_schedule_morth():
    res = client.post(
        "/ml/hos-schedule",
        json={
            "current_continuous_driving_hours": 3.0,
            "current_shift_driving_hours": 3.0,
            "planned_trip_hours": 4.0,
            "regulation_standard": "morth",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["regulation_standard"] == "morth"
    assert data["can_complete_within_legal_shift"] is True
    # 4.5h continuous limit - 3.0h current = 1.5h until break
    assert len(data["scheduled_breaks"]) == 1
    assert data["scheduled_breaks"][0]["trip_offset_hours"] == 1.5
    assert data["scheduled_breaks"][0]["break_duration_minutes"] == 30
    assert data["total_elapsed_hours"] == 4.5  # 4h trip + 0.5h break


def test_generate_hos_schedule_shift_violation():
    res = client.post(
        "/ml/hos-schedule",
        json={
            "current_continuous_driving_hours": 1.0,
            "current_shift_driving_hours": 7.0,
            "planned_trip_hours": 3.0,
            "regulation_standard": "morth",
        },
    )
    assert res.status_code == 200
    data = res.json()
    # 8.0 daily limit - 7.0 = 1.0 remaining, planned is 3.0 -> violation!
    assert data["can_complete_within_legal_shift"] is False
    assert data["shift_violation_risk"] is True
    assert data["remaining_legal_driving_hours"] == 1.0


def test_generate_hos_schedule_fmcsa():
    res = client.post(
        "/ml/hos-schedule",
        json={
            "current_continuous_driving_hours": 0.0,
            "current_shift_driving_hours": 0.0,
            "planned_trip_hours": 10.0,
            "regulation_standard": "fmcsa",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["regulation_standard"] == "fmcsa"
    assert data["can_complete_within_legal_shift"] is True
    # 8h continuous limit: break at 8.0h
    assert len(data["scheduled_breaks"]) == 1
    assert data["scheduled_breaks"][0]["trip_offset_hours"] == 8.0
