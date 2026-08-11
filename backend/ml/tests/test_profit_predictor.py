"""Unit tests for backend/ml/profit_predictor.py.

Run with: python3 -m pytest tests/test_profit_predictor.py -v --no-header
"""
import numpy as np
import pandas as pd
from profit_predictor import (
    create_pipeline,
    generate_dummy_data,
    numeric_features,
)


class TestCreatePipeline:
    """Tests for the profit-predictor pipeline factory."""

    def test_returns_sklearn_pipeline(self):
        """create_pipeline must return a usable scikit-learn Pipeline."""
        pipeline = create_pipeline()
        from sklearn.pipeline import Pipeline
        assert isinstance(pipeline, Pipeline)

    def test_pipeline_fits_and_predicts(self):
        """The pipeline must fit on the synthetic data and predict."""
        X, y = generate_dummy_data(n_samples=100)
        pipeline = create_pipeline()
        pipeline.fit(X, y)
        preds = pipeline.predict(X.head(5))
        assert preds.shape == (5,)

    def test_preprocessor_targets_numeric_features(self):
        """The preprocessor must scale the documented numeric features."""
        pipeline = create_pipeline()
        transformer = pipeline.named_steps["preprocessor"]
        column_names = transformer.transformers[0][2]
        assert sorted(column_names) == sorted(numeric_features)


class TestGenerateDummyData:
    """Tests for the synthetic data generator."""

    def test_returns_dataframe_and_target(self):
        """X must be a DataFrame with the 4 feature columns; y a Series."""
        X, y = generate_dummy_data(n_samples=50)
        assert isinstance(X, pd.DataFrame)
        assert list(X.columns) == numeric_features
        assert len(y) == 50

    def test_is_deterministic(self):
        """Seeded generation must be reproducible."""
        X1, y1 = generate_dummy_data(n_samples=50)
        X2, y2 = generate_dummy_data(n_samples=50)
        assert np.allclose(X1.values, X2.values)
        assert np.allclose(y1, y2)

    def test_profit_is_positive_on_average(self):
        """With the given revenue/cost model, mean profit must be positive."""
        _, y = generate_dummy_data(n_samples=200)
        assert float(y.mean()) > 0
