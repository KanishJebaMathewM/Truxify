from fastapi.testclient import TestClient
from app import app

client = TestClient(app)


def test_calculate_fuel_surcharge_positive():
    res = client.post(
        "/ml/fuel-surcharge",
        json={
            "base_fuel_price_per_liter": 90.0,
            "current_fuel_price_per_liter": 97.0,
            "route_distance_km": 350.0,
            "fuel_mileage_km_per_liter": 3.5,
            "base_freight_rate": 15000.0,
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["liters_consumed"] == 100.0   # 350 / 3.5
    assert data["fuel_price_diff"] == 7.0     # 97 - 90
    assert data["surcharge_amount"] == 700.0  # 100 * 7
    assert data["total_freight_cost"] == 15700.0  # 15000 + 700
    assert round(data["surcharge_percent"], 2) == 4.67


def test_calculate_fuel_surcharge_no_increase():
    res = client.post(
        "/ml/fuel-surcharge",
        json={
            "base_fuel_price_per_liter": 95.0,
            "current_fuel_price_per_liter": 90.0,
            "route_distance_km": 350.0,
            "base_freight_rate": 15000.0,
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["surcharge_amount"] == 0.0
    assert data["total_freight_cost"] == 15000.0


def test_calculate_fuel_surcharge_validation_failure():
    res = client.post(
        "/ml/fuel-surcharge",
        json={
            "base_fuel_price_per_liter": -10.0,
            "current_fuel_price_per_liter": 90.0,
            "route_distance_km": 350.0,
            "base_freight_rate": 15000.0,
        },
    )
    assert res.status_code == 422
