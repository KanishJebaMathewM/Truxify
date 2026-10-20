import pytest

from app.models.predictive_maintenance import PredictiveMaintenanceModel


NORMAL = {
    "engine_temperature": 90.0,
    "tire_pressure": 35.0,
    "oil_level": 80.0,
    "coolant_level": 80.0,
    "mileage": 50000.0,
}


@pytest.mark.parametrize("field", list(NORMAL))
@pytest.mark.parametrize("value", [float("nan"), float("inf"), -float("inf")])
def test_nonfinite_sensor_readings_are_rejected(field, value):
    payload = {**NORMAL, field: value}
    with pytest.raises(ValueError, match="finite"):
        PredictiveMaintenanceModel().predict(**payload)


def test_missing_sensor_data_cannot_report_normal_conditions():
    payload = {field: float("nan") for field in NORMAL}
    with pytest.raises(ValueError, match="finite"):
        PredictiveMaintenanceModel().predict(**payload)
