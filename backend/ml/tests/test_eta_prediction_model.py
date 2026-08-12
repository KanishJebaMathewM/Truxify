"""Unit tests for backend/ml/app/models/eta_prediction.py.

Run with: python3 -m pytest tests/test_eta_prediction_model.py -v --no-header
"""
import hashlib
import pickle

import numpy as np
import pytest

import app.models.eta_prediction as eta_mod
from app.models.eta_prediction import ETAPredictor


class _StubModel:
    def predict(self, features):
        return np.array([30.0])


class TestGenerateSyntheticData:
    """Tests for the synthetic ETA data generator."""

    def test_shape(self):
        """X must be (n, 5) and y must be (n,)."""
        predictor = ETAPredictor()
        X, y = predictor.generate_synthetic_data(n=100)
        assert X.shape == (100, 5)
        assert y.shape == (100,)

    def test_is_deterministic(self):
        """Seeded generation must be reproducible."""
        predictor = ETAPredictor()
        X1, y1 = predictor.generate_synthetic_data(n=50)
        X2, y2 = predictor.generate_synthetic_data(n=50)
        assert np.allclose(X1, X2)
        assert np.allclose(y1, y2)

    def test_feature_columns_match_documented_schema(self):
        """The 5 columns are distance, time_of_day, day_of_week, route_type, speed."""
        predictor = ETAPredictor()
        X, _ = predictor.generate_synthetic_data(n=50)
        # Column 0: distance in [5, 1200]; column 1: hour in [0, 24)
        assert np.all(X[:, 0] >= 5) and np.all(X[:, 0] <= 1200)
        assert np.all(X[:, 1] >= 0) and np.all(X[:, 1] < 24)
        assert np.all(X[:, 2] >= 0) and np.all(X[:, 2] < 7)
        assert set(np.unique(X[:, 3])).issubset({0, 1})


class TestPredict:
    """Tests for ETA prediction."""

    def test_predict_returns_expected_keys(self):
        """The prediction must expose eta_minutes and a confidence interval."""
        predictor = ETAPredictor()
        predictor.model = object()

        class StubModel:
            def predict(self, features):
                return np.array([30.0])

        predictor.model = StubModel()
        result = predictor.predict(100.0, 10, 1, 1, 60.0)
        assert set(result.keys()) == {"eta_minutes", "confidence_interval"}
        assert result["eta_minutes"] == 30.0
        assert result["confidence_interval"]["min"] == 27.0
        assert result["confidence_interval"]["max"] == 33.0

    def test_eta_is_clamped_to_at_least_one(self):
        """A sub-1-minute prediction must be clamped to 1.0."""
        predictor = ETAPredictor()

        class StubModel:
            def predict(self, features):
                return np.array([0.2])

        predictor.model = StubModel()
        result = predictor.predict(1.0, 0, 0, 0, 80.0)
        assert result["eta_minutes"] == 1.0
        assert result["confidence_interval"]["min"] == 1.0

    def test_string_route_type_is_mapped(self):
        """'highway' maps to 1, anything else maps to 0."""
        predictor = ETAPredictor()

        captured = {}

        class StubModel:
            def predict(self, features):
                captured["route_type"] = float(features[0][3])
                return np.array([30.0])

        predictor.model = StubModel()
        predictor.predict(100.0, 10, 1, "highway", 60.0)
        assert captured["route_type"] == 1.0

        predictor.predict(100.0, 10, 1, "city", 60.0)
        assert captured["route_type"] == 0.0


class TestFailLoudWhenArtifactsAbsent:
    """Serving predictions from synthetic data must never happen silently."""

    @pytest.fixture(autouse=True)
    def _isolated_paths(self, tmp_path, monkeypatch):
        """Point the module at a scratch directory for every test."""
        monkeypatch.setattr(
            eta_mod, "MODEL_PATH", str(tmp_path / "eta_predictor.pkl")
        )
        monkeypatch.setattr(
            eta_mod, "MODEL_HASH_PATH", str(tmp_path / "eta_predictor.sha256")
        )

    def test_train_raises_not_implemented(self):
        """Automatic synthetic training is forbidden."""
        with pytest.raises(NotImplementedError):
            ETAPredictor().train()

    def test_load_raises_when_artifacts_missing(self):
        """load() must fail loudly instead of silently generating data."""
        predictor = ETAPredictor()
        with pytest.raises(RuntimeError, match="artifacts missing"):
            predictor.load()
        assert predictor.model is None

    def test_load_raises_on_hash_mismatch(self):
        """A corrupt artifact must be rejected by the integrity check."""
        model_path = eta_mod.MODEL_PATH
        with open(model_path, "wb") as f:
            f.write(b"tampered-model-bytes")
        with open(eta_mod.MODEL_HASH_PATH, "w") as f:
            f.write(hashlib.sha256(b"something-else").hexdigest())

        with pytest.raises(RuntimeError, match="integrity check failed"):
            ETAPredictor().load()

    def test_predict_fails_loud_when_no_model(self):
        """predict() must surface the load failure instead of guessing."""
        predictor = ETAPredictor()
        with pytest.raises(RuntimeError, match="artifacts missing"):
            predictor.predict(100.0, 10, 1, 1, 60.0)

    def test_load_succeeds_with_verified_artifact(self):
        """A real artifact with a matching hash loads and is marked real."""
        model_bytes = pickle.dumps(_StubModel())
        with open(eta_mod.MODEL_PATH, "wb") as f:
            f.write(model_bytes)
        with open(eta_mod.MODEL_HASH_PATH, "w") as f:
            f.write(hashlib.sha256(model_bytes).hexdigest())

        predictor = ETAPredictor()
        predictor.load()
        assert predictor.trained_on == "real"
        result = predictor.predict(100.0, 10, 1, 1, 60.0)
        assert result["eta_minutes"] == 30.0
