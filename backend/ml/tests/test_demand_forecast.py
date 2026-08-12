"""
Unit tests for backend/ml/app/models/demand_forecast.py

Run with: python3 -m pytest tests/test_demand_forecast.py -v --no-header
"""
import os
import pytest

os.environ["ML_API_KEY"] = "test_key"


class TestModelCacheInvalidation:
    """Tests for _model_cache invalidation after training."""

    def test_predict_demand_returns_float(self, monkeypatch, tmp_path):
        """Basic smoke test: predict_demand returns a non-negative float."""
        monkeypatch.setattr("app.models.base.MODEL_STORAGE_DIR", str(tmp_path))
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
        monkeypatch.setattr("app.models.base.MODEL_STORAGE_DIR", str(tmp_path))
        import app.models.demand_forecast as df_module

        # Ensure cache is populated first
        df_module._model_cache = ("fake_model", "fake_scaler")

        monkeypatch.chdir(tmp_path)

        # train_demand_forecast_model should call reset_model_cache internally
        from app.models.demand_forecast import train_demand_forecast_model
        train_demand_forecast_model()

        # Cache should be None after training
        assert df_module._model_cache is None, (
            "train_demand_forecast_model should reset _model_cache after saving. "
            "Subsequent predictions would otherwise use the stale cached copy."
        )

    def test_predict_after_train_uses_disk_model(self, monkeypatch, tmp_path):
        """Verify that predict_demand works correctly after train completes,
        confirming the cache was reset and the new model was loaded."""
        monkeypatch.setattr("app.models.base.MODEL_STORAGE_DIR", str(tmp_path))
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


class TestDemandForecastPromotionAndRollback:
    """Tests for demand forecast model promotion gating and rollback."""

    def test_train_promotes_when_no_existing_model(self, monkeypatch, tmp_path):
        monkeypatch.setattr("app.models.base.MODEL_STORAGE_DIR", str(tmp_path))
        from app.models.demand_forecast import train_demand_forecast_model
        metrics = train_demand_forecast_model()
        assert metrics["promoted"] is True
        assert "first training run promoted" in metrics["promotion_reason"]

    def test_train_does_not_promote_when_improvement_below_threshold(self, monkeypatch, tmp_path):
        monkeypatch.setattr("app.models.base.MODEL_STORAGE_DIR", str(tmp_path))
        from app.models.base import save_model, load_model
        from app.models.demand_forecast import train_demand_forecast_model, MODEL_NAME

        # Save an initial model with a very low MAE (e.g. 0.001)
        old_model = ("old_model", "old_scaler")
        save_model(old_model, MODEL_NAME, metrics={"mae": 0.001})

        metrics = train_demand_forecast_model()
        assert metrics["promoted"] is False
        assert "did not improve on production MAE" in metrics["promotion_reason"]
        # Verify existing production model was NOT overwritten
        assert load_model(MODEL_NAME) == old_model

    def test_train_promotes_when_improvement_meets_threshold(self, monkeypatch, tmp_path):
        monkeypatch.setattr("app.models.base.MODEL_STORAGE_DIR", str(tmp_path))
        from app.models.base import save_model, load_model
        from app.models.demand_forecast import train_demand_forecast_model, MODEL_NAME

        # Save an initial model with a high MAE (e.g. 100.0)
        old_model = ("old_model", "old_scaler")
        save_model(old_model, MODEL_NAME, metrics={"mae": 100.0})

        metrics = train_demand_forecast_model()
        assert metrics["promoted"] is True
        assert "improved on production MAE" in metrics["promotion_reason"]
        # Verify model was updated
        loaded_model = load_model(MODEL_NAME)
        assert loaded_model != old_model

    def test_rollback_demand_forecast_model(self, monkeypatch, tmp_path):
        monkeypatch.setattr("app.models.base.MODEL_STORAGE_DIR", str(tmp_path))
        from app.models.base import save_model, load_model
        from app.models.demand_forecast import rollback_demand_forecast_model, MODEL_NAME

        # Case 1: No previous version exists
        res_no_prev = rollback_demand_forecast_model()
        assert res_no_prev["rolled_back"] is False
        assert "No previous version available" in res_no_prev["reason"]

        # Case 2: Save version 1 and version 2, then rollback
        model_v1 = ("v1_model", "v1_scaler")
        model_v2 = ("v2_model", "v2_scaler")
        save_model(model_v1, MODEL_NAME, metrics={"mae": 10.0})
        save_model(model_v2, MODEL_NAME, metrics={"mae": 5.0})

        assert load_model(MODEL_NAME) == model_v2

        res_rollback = rollback_demand_forecast_model()
        assert res_rollback["rolled_back"] is True
        assert res_rollback["metrics"]["mae"] == 10.0
        assert load_model(MODEL_NAME) == model_v1
