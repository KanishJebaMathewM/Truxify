
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers.deadhead import router

app = FastAPI()
app.include_router(router)

client = TestClient(app)


ENDPOINT = "/ml/deadhead-carbon-savings"


def calculate_savings(payload):
    return client.post(ENDPOINT, json=payload)


class TestDeadheadCarbonSavings:

    # 1. Default parameter calculation
    def test_default_parameters(self):
        response = calculate_savings({
            "deadhead_km_avoided": 100.0
        })

        assert response.status_code == 200

        data = response.json()

        assert data["success"] is True
        assert data["deadhead_km_avoided"] == 100.0
        assert data["fuel_saved_liters"] == pytest.approx(32.0)
        assert data["co2_avoided_kg"] == pytest.approx(85.0)
        assert data["cost_saved"] == pytest.approx(2960.0)
        assert data["metric_tons_co2"] == pytest.approx(0.085)

    # 2. Custom parameter calculation
    def test_custom_parameters(self):
        response = calculate_savings({
            "deadhead_km_avoided": 50.0,
            "fuel_consumption_lpkm": 0.40,
            "emission_factor_kg_per_km": 1.0,
            "fuel_price_per_liter": 95.0,
        })

        assert response.status_code == 200

        data = response.json()

        assert data["fuel_saved_liters"] == pytest.approx(20.0)
        assert data["co2_avoided_kg"] == pytest.approx(50.0)
        assert data["cost_saved"] == pytest.approx(1900.0)
        assert data["metric_tons_co2"] == pytest.approx(0.05)

    # 3. Negative distance validation
    def test_negative_distance(self):
        response = calculate_savings({
            "deadhead_km_avoided": -10.0
        })

        assert response.status_code == 422

    # 4. Zero distance boundary case
    def test_zero_distance(self):
        response = calculate_savings({
            "deadhead_km_avoided": 0.0
        })

        assert response.status_code == 200

        data = response.json()

        assert data["success"] is True
        assert data["fuel_saved_liters"] == 0.0
        assert data["co2_avoided_kg"] == 0.0
        assert data["cost_saved"] == 0.0
        assert data["metric_tons_co2"] == 0.0

    # 5. Missing required field
    def test_missing_distance(self):
        response = calculate_savings({})

        assert response.status_code == 422

    # 6. Invalid input type
    def test_invalid_distance_type(self):
        response = calculate_savings({
            "deadhead_km_avoided": "invalid"
        })

        assert response.status_code == 422

    # 7. Verify CO2 conversion
    def test_metric_tons_conversion(self):
        response = calculate_savings({
            "deadhead_km_avoided": 100.0
        })

        assert response.status_code == 200

        data = response.json()

        expected_tons = data["co2_avoided_kg"] / 1000

        assert data["metric_tons_co2"] == pytest.approx(
            expected_tons
        )

    # 8. Large distance calculation
    def test_large_distance(self):
        response = calculate_savings({
            "deadhead_km_avoided": 10000.0
        })

        assert response.status_code == 200

        data = response.json()

        assert data["fuel_saved_liters"] == pytest.approx(3200.0)
        assert data["co2_avoided_kg"] == pytest.approx(8500.0)

    # 9. Negative fuel price validation
    def test_negative_fuel_price(self):
        response = calculate_savings({
            "deadhead_km_avoided": 100.0,
            "fuel_price_per_liter": -10.0,
        })

        assert response.status_code == 422

    # 10. Negative fuel consumption validation
    def test_negative_fuel_consumption(self):
        response = calculate_savings({
            "deadhead_km_avoided": 100.0,
            "fuel_consumption_lpkm": -0.5,
        })

        assert response.status_code == 422
