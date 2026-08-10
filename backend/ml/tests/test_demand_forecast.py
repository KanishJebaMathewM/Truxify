"""
Unit tests for backend/ml/app/models/demand_forecast.py

Run with: python3 -m pytest tests/test_demand_forecast.py -v --no-header
"""
import os
import tempfile
import pytest

# Set up a temp model directory before importing the module
os.environ["ML_API_KEY"] = "test_key"


class TestModelCacheInvalidation:
    """Tests for _model_cache invalidation after training."""

    def test_predict_demand_returns_float(self, tmp_path):
        """Basic smoke test: predict_demand returns a non-negative float."""
        from app.models.demand_forecast import predict_demand

        result = predict_demand([12, 3, 0, 25.0, 0.5, 50, 15])
        assert isinstance(result, float)
        assert result >= 0

    def test_reset_model_cache_function_exists(self):
        """reset_model_cache should be importable and callable."""
        from app.models.demand_forecast import reset_model_cache

        # Calling reset multiple times should not raise
        reset_model_cache()
        reset_model_cache()

    def test_train_resets_cache(self, monkeypatch, tmp_path):
        """After train_demand_forecast_model, the cache should be invalidated
        so subsequent predictions use the newly saved model."""
        import app.models.demand_forecast as df_module

        # Ensure cache is populated first
        df_module._model_cache = ("fake_model", "fake_scaler")

        # Train in a temp directory
        monkeypatch.chdir(tmp_path)

        # train_demand_forecast_model should call reset_model_cache internally
        from app.models.demand_forecast import train_demand_forecast_model
        train_demand_forecast_model()

        # Cache should be None after training
        assert df_module._model_cache is None, (
            "train_demand_forecast_model should reset _model_cache after saving. "
            "Subsequent predictions would otherwise use the stale cached model."
        )

    def test_predict_after_train_uses_disk_model(self, monkeypatch, tmp_path):
        """Verify that predict_demand works correctly after train completes,
        confirming the cache was reset and the new model was loaded."""
        import app.models.demand_forecast as df_module

        monkeypatch.chdir(tmp_path)

        # Train the model
        from app.models.demand_forecast import train_demand_forecast_model, predict_demand
        train_demand_forecast_model()

        # Cache should be None (was invalidated by train)
        assert df_module._model_cache is None

        # Predict should load from disk and work
        result = predict_demand([12, 3, 0, 25.0, 0.5, 50, 15])
        assert isinstance(result, float)
        assert result >= 0
