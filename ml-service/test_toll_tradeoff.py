from fastapi.testclient import TestClient
from app import app

client = TestClient(app)


def test_analyze_toll_tradeoff_pay_toll_cheaper():
    # Toll fee is 350. Detour adds 30km (fuel ~790 + wear 120 + driver 125 = ~1035). Paying toll is far cheaper.
    res = client.post(
        "/ml/toll-tradeoff",
        json={
            "toll_route_distance_km": 100.0,
            "toll_fee_amount": 350.0,
            "detour_route_distance_km": 130.0,
            "detour_extra_time_minutes": 30.0,
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["recommendation"] == "PAY_TOLL"
    assert data["should_take_detour"] is False
    assert data["total_detour_cost"] > data["toll_fee"]


def test_analyze_toll_tradeoff_avoid_toll_cheaper():
    # Very high toll 1200, detour is only 2km extra and 5 minutes. Avoiding toll saves money.
    res = client.post(
        "/ml/toll-tradeoff",
        json={
            "toll_route_distance_km": 50.0,
            "toll_fee_amount": 1200.0,
            "detour_route_distance_km": 52.0,
            "detour_extra_time_minutes": 5.0,
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["recommendation"] == "AVOID_TOLL"
    assert data["should_take_detour"] is True
    assert data["total_detour_cost"] < data["toll_fee"]


def test_analyze_toll_tradeoff_validation():
    res = client.post(
        "/ml/toll-tradeoff",
        json={
            "toll_route_distance_km": -10.0,
            "toll_fee_amount": 300.0,
            "detour_route_distance_km": 20.0,
            "detour_extra_time_minutes": 10.0,
        },
    )
    assert res.status_code == 422
