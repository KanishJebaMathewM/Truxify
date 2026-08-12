"""Unit tests for backend/ml/meta/meta_pricing.py.

Run with: python3 -m pytest tests/test_meta_pricing.py -v --no-header
"""
import numpy as np
from meta.meta_pricing import MamlBilevelPricingOptimizer


class TestInnerLoopAdapt:
    """Tests for the inner-loop gradient adaptation."""

    def setup_method(self):
        self.optimizer = MamlBilevelPricingOptimizer()

    def test_adapted_weights_differ_from_meta_weights(self):
        """Adapting on local support data must move the meta weights."""
        data = np.array([[1.0, 2.0, 1.0], [2.0, 1.0, 2.0]])
        prices = np.array([50.0, 55.0])
        adapted = self.optimizer.inner_loop_adapt(data, prices)
        assert not np.allclose(adapted, self.optimizer.meta_weights)

    def test_matches_hand_computed_gradient(self):
        """Verify the gradient step against an explicit computation."""
        data = np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]])
        prices = np.array([3.0, 2.0])
        # predictions = data @ meta_weights
        meta = self.optimizer.meta_weights  # [2.0, 1.1, 0.75]
        predictions = data @ meta
        error = predictions - prices
        grad = data.T @ error / len(prices)
        expected = meta - self.optimizer.inner_lr * grad
        adapted = self.optimizer.inner_loop_adapt(data, prices)
        assert np.allclose(adapted, expected)

    def test_gradient_is_zero_for_perfect_fit(self):
        """When the base weights already fit, adaptation should be a no-op."""
        data = np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]])
        prices = data @ self.optimizer.meta_weights
        adapted = self.optimizer.inner_loop_adapt(data, prices)
        assert np.allclose(adapted, self.optimizer.meta_weights)


class TestPredictAdaptedFare:
    """Tests for the few-shot fare prediction."""

    def setup_method(self):
        self.optimizer = MamlBilevelPricingOptimizer()

    def test_returns_expected_keys(self):
        data = np.array([[1.0, 2.0, 1.0], [2.0, 1.0, 2.0]])
        prices = np.array([50.0, 55.0])
        result = self.optimizer.predict_adapted_fare(
            100.0, 5.0, 10.0, data, prices
        )
        assert set(result.keys()) == {
            "predicted_fare_inr",
            "adapted_weights",
            "few_shot_adapted",
        }
        assert result["few_shot_adapted"] is True

    def test_fare_includes_base_constant(self):
        """A zero-feature prediction should equal the +40 base constant."""
        data = np.array([[1.0, 0.0, 0.0]])
        prices = np.array([2.0])
        result = self.optimizer.predict_adapted_fare(0.0, 0.0, 0.0, data, prices)
        assert result["predicted_fare_inr"] == 40.0

    def test_longer_distance_gives_higher_fare(self):
        """Fare must be monotonically increasing in distance."""
        data = np.array([[1.0, 0.0, 0.0]])
        prices = np.array([2.0])
        short = self.optimizer.predict_adapted_fare(50.0, 5.0, 10.0, data, prices)
        long_ = self.optimizer.predict_adapted_fare(200.0, 5.0, 10.0, data, prices)
        assert long_["predicted_fare_inr"] > short["predicted_fare_inr"]

    def test_adapted_weights_are_rounded_to_4_decimals(self):
        data = np.array([[1.0, 2.0, 1.0], [2.0, 1.0, 2.0]])
        prices = np.array([50.0, 55.0])
        result = self.optimizer.predict_adapted_fare(100.0, 5.0, 10.0, data, prices)
        assert all(abs(w - round(w, 4)) < 1e-9 for w in result["adapted_weights"])
