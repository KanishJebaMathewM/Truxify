"""Unit tests for backend/ml/app/models/driver_profit.py.

Run with: python3 -m pytest tests/test_driver_profit_predictor.py -v --no-header
"""
import numpy as np
import pytest
from app.models.driver_profit import (
    FEATURE_NAMES,
    DriverProfitPredictor,
    _generate_synthetic_data,
)


class TestGenerateSyntheticData:
    """Tests for the synthetic data generator."""

    def test_shape(self):
        """X must be (n_samples, 6) and y must be (n_samples,)."""
        X, y = _generate_synthetic_data(n_samples=100)
        assert X.shape == (100, 6)
        assert y.shape == (100,)

    def test_feature_count_matches_feature_names(self):
        """The 6 columns must match the documented FEATURE_NAMES."""
        X, _ = _generate_synthetic_data(n_samples=50)
        assert X.shape[1] == len(FEATURE_NAMES) == 6

    def test_is_deterministic(self):
        """Seeded generation must be reproducible."""
        X1, y1 = _generate_synthetic_data(n_samples=50)
        X2, y2 = _generate_synthetic_data(n_samples=50)
        assert np.allclose(X1, X2)
        assert np.allclose(y1, y2)


class TestDriverProfitPredictor:
    """Tests for the profit predictor."""

    def test_feature_names_are_expected(self):
        """The feature list must match the documented schema."""
        assert FEATURE_NAMES == [
            "route_distance",
            "fuel_price",
            "toll_estimate",
            "truck_mileage",
            "cargo_weight",
            "trip_duration",
        ]

    def test_predict_returns_expected_keys(self):
        """A trained model must return the profit and confidence interval."""
        predictor = DriverProfitPredictor()
        predictor.model = object()  # placeholder to skip auto-load
        # Stub the model surface predict() uses.
        class StubModel:
            def predict(self, features):
                return np.array([5000.0])

            def staged_predict(self, features):
                return [np.array([1000.0]), np.array([3000.0]), np.array([5000.0])]

        predictor.model = StubModel()
        result = predictor.predict(500.0, 105.0, 1200.0, 5.0, 8000.0, 10.0)
        assert set(result.keys()) == {"predicted_profit", "confidence_interval"}
        assert result["predicted_profit"] == 5000.0
        assert "lower" in result["confidence_interval"]
        assert "upper" in result["confidence_interval"]

    def test_confidence_interval_lower_is_non_negative(self):
        """The lower bound must never be negative."""
        predictor = DriverProfitPredictor()

        class StubModel:
            def predict(self, features):
                return np.array([100.0])

            def staged_predict(self, features):
                return [np.array([-50.0]), np.array([30.0]), np.array([100.0])]

        predictor.model = StubModel()
        result = predictor.predict(100.0, 100.0, 100.0, 5.0, 1000.0, 2.0)
        assert result["confidence_interval"]["lower"] >= 0.0
