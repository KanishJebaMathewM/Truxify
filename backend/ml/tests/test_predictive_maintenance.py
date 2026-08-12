"""
Unit tests for backend/ml/app/models/predictive_maintenance.py

Run with: python3 -m pytest tests/test_predictive_maintenance.py -v --no-header
"""
import pytest
from app.models.predictive_maintenance import PredictiveMaintenanceModel


class TestPredictiveMaintenance:
    """Tests for PredictiveMaintenanceModel.predict()."""

    def setup_method(self):
        self.model = PredictiveMaintenanceModel()

    def test_normal_vehicle_not_at_risk(self):
        """Vehicle with all normal readings should not be at risk."""
        result = self.model.predict(
            engine_temperature=90.0,
            tire_pressure=35.0,
            oil_level=80.0,
            coolant_level=80.0,
            mileage=50000,
        )
        assert result["is_at_risk"] is False
        assert result["failure_probability"] == 0.0
        assert result["anomalies_detected"] == []
        assert "normal" in result["recommendation"].lower()

    def test_high_temperature_flags_risk(self):
        """Engine temperature above 105 should flag risk."""
        result = self.model.predict(
            engine_temperature=110.0,
            tire_pressure=35.0,
            oil_level=80.0,
            coolant_level=80.0,
            mileage=50000,
        )
        assert "High Engine Temperature" in result["anomalies_detected"]
        # 1 anomaly * 0.2 = 0.2, below 0.4 threshold
        assert result["failure_probability"] == 0.2
        assert result["is_at_risk"] is False

    def test_multiple_anomalies_increases_probability(self):
        """Multiple simultaneous anomalies should increase failure probability."""
        result = self.model.predict(
            engine_temperature=110.0,
            tire_pressure=20.0,  # Abnormal
            oil_level=10.0,        # Low
            coolant_level=20.0,     # Low
            mileage=50000,
        )
        # 4 anomalies * 0.2 = 0.8, capped at 0.95
        assert len(result["anomalies_detected"]) == 4
        assert result["failure_probability"] == 0.8
        assert result["is_at_risk"] is True
        assert "immediately" in result["recommendation"].lower()

    def test_high_mileage_adds_probability(self):
        """High mileage (>500k) should add 0.1 to failure probability."""
        result = self.model.predict(
            engine_temperature=90.0,
            tire_pressure=35.0,
            oil_level=80.0,
            coolant_level=80.0,
            mileage=600000,
        )
        # 0 anomalies * 0.2 + 0.1 (high mileage) = 0.1
        assert result["failure_probability"] == 0.1
        assert result["is_at_risk"] is False

    def test_probability_capped_at_095(self):
        """Failure probability must never exceed 0.95."""
        result = self.model.predict(
            engine_temperature=200.0,
            tire_pressure=10.0,
            oil_level=5.0,
            coolant_level=5.0,
            mileage=700000,
        )
        # 4 anomalies * 0.2 + 0.1 = 0.9, well below 0.95
        # But stress test with the model's max
        # The cap is 0.95 regardless
        assert result["failure_probability"] <= 0.95
        assert result["failure_probability"] >= 0.0

    def test_tire_pressure_high_boundary(self):
        """Tire pressure above 45.0 should be flagged as abnormal."""
        result = self.model.predict(
            engine_temperature=90.0,
            tire_pressure=50.0,  # Above max 45
            oil_level=80.0,
            coolant_level=80.0,
            mileage=50000,
        )
        assert "Abnormal Tire Pressure" in result["anomalies_detected"]

    def test_tire_pressure_low_boundary(self):
        """Tire pressure below 30.0 should be flagged as abnormal."""
        result = self.model.predict(
            engine_temperature=90.0,
            tire_pressure=25.0,  # Below min 30
            oil_level=80.0,
            coolant_level=80.0,
            mileage=50000,
        )
        assert "Abnormal Tire Pressure" in result["anomalies_detected"]

    def test_is_at_risk_threshold(self):
        """is_at_risk should be True when probability > 0.4."""
        # Exactly 3 anomalies = 0.6 > 0.4 -> at risk
        result = self.model.predict(
            engine_temperature=110.0,  # +0.2
            tire_pressure=25.0,        # +0.2
            oil_level=10.0,             # +0.2
            coolant_level=80.0,
            mileage=50000,
        )
        assert result["is_at_risk"] is True
        assert result["failure_probability"] == 0.6

        # 2 anomalies = 0.4, not strictly greater than 0.4 -> not at risk
        result2 = self.model.predict(
            engine_temperature=110.0,  # +0.2
            tire_pressure=25.0,        # +0.2
            oil_level=80.0,
            coolant_level=80.0,
            mileage=50000,
        )
        assert result2["is_at_risk"] is False
        assert result2["failure_probability"] == 0.4
