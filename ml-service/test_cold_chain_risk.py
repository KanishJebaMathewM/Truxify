from fastapi.testclient import TestClient
from app import app

client = TestClient(app)


def test_predict_cold_chain_risk_low():
    res = client.post(
        "/ml/cold-chain-risk",
        json={
            "current_temp_celsius": 4.0,
            "target_temp_celsius": 4.0,
            "max_tolerable_temp_celsius": 8.0,
            "ambient_temp_celsius": 32.0,
            "remaining_duration_hours": 3.0,
            "unit_health_factor": 1.0,
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["risk_level"] == "LOW"
    assert data["requires_immediate_intervention"] is False
    assert data["time_to_breach_minutes"] is None


def test_predict_cold_chain_risk_critical_already_breached():
    res = client.post(
        "/ml/cold-chain-risk",
        json={
            "current_temp_celsius": 9.0,
            "target_temp_celsius": 4.0,
            "max_tolerable_temp_celsius": 8.0,
            "ambient_temp_celsius": 38.0,
            "remaining_duration_hours": 2.0,
            "unit_health_factor": 0.5,
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["risk_level"] == "CRITICAL"
    assert data["requires_immediate_intervention"] is True
    assert data["time_to_breach_minutes"] == 0.0


def test_predict_cold_chain_risk_degraded_reefer():
    res = client.post(
        "/ml/cold-chain-risk",
        json={
            "current_temp_celsius": 7.5,
            "target_temp_celsius": 4.0,
            "max_tolerable_temp_celsius": 8.0,
            "ambient_temp_celsius": 42.0,
            "remaining_duration_hours": 4.0,
            "unit_health_factor": 0.2,
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["risk_level"] in ["MEDIUM", "CRITICAL"]
    assert data["predicted_temp_at_destination"] > 8.0
    assert data["time_to_breach_minutes"] is not None
