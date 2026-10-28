from fastapi import FastAPI
from fastapi.testclient import TestClient
from routers.deadhead import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)


def test_calculate_carbon_savings_default_parameters():
    res = client.post("/ml/deadhead-carbon-savings", json={"deadhead_km_avoided": 100.0})
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["deadhead_km_avoided"] == 100.0
    assert data["fuel_saved_liters"] == 32.0  # 100 * 0.32
    assert data["co2_avoided_kg"] == 85.0    # 100 * 0.85
    assert data["cost_saved"] == 2960.0      # 32 * 92.50
    assert data["metric_tons_co2"] == 0.085


def test_calculate_carbon_savings_custom_parameters():
    res = client.post(
        "/ml/deadhead-carbon-savings",
        json={
            "deadhead_km_avoided": 50.0,
            "fuel_consumption_lpkm": 0.40,
            "emission_factor_kg_per_km": 1.0,
            "fuel_price_per_liter": 95.0,
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["fuel_saved_liters"] == 20.0
    assert data["co2_avoided_kg"] == 50.0
    assert data["cost_saved"] == 1900.0


def test_calculate_carbon_savings_validation_error():
    res = client.post("/ml/deadhead-carbon-savings", json={"deadhead_km_avoided": -10.0})
    assert res.status_code == 422
