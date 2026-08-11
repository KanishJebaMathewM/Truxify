"""Unit tests for backend/ml/gat/gat_congestion.py.

Run with: python3 -m pytest tests/test_gat_congestion.py -v --no-header
"""
import numpy as np
from gat.gat_congestion import GraphAttentionNetworkCongestionModel


class TestComputeNodeAttention:
    """Tests for the self-attention computation."""

    def setup_method(self):
        self.model = GraphAttentionNetworkCongestionModel()

    def test_returns_one_score_per_node(self):
        """Attention output must have one entry per node."""
        features = np.array([[60.0, 120.0, 2.0], [25.0, 450.0, 15.0]])
        scores = self.model.compute_node_attention(features)
        assert scores.shape == (2,)

    def test_scores_are_in_unit_interval(self):
        """Sigmoid activation must keep scores in (0, 1)."""
        features = np.array([[60.0, 120.0, 2.0], [25.0, 450.0, 15.0], [70.0, 90.0, 1.0]])
        scores = self.model.compute_node_attention(features)
        assert np.all(scores > 0.0) and np.all(scores < 1.0)

    def test_matches_hand_computed_logistic(self):
        """score = 1 / (1 + exp(-(x·w + b)))."""
        features = np.array([[60.0, 120.0, 2.0]])
        weights = self.model.attention_weights
        bias = self.model.bias
        logit = float((features @ weights + bias).item())
        expected = 1.0 / (1.0 + np.exp(-logit))
        assert np.isclose(float(self.model.compute_node_attention(features)[0]), expected)


class TestPredictBottleneckDelays:
    """Tests for the bottleneck-delay predictions."""

    def setup_method(self):
        self.model = GraphAttentionNetworkCongestionModel()

    def test_returns_one_prediction_per_node(self):
        """The predictions list must have one entry per node."""
        features = np.array([[60.0, 120.0, 2.0], [25.0, 450.0, 15.0]])
        predictions = self.model.predict_bottleneck_delays(features)
        assert len(predictions) == 2

    def test_prediction_keys(self):
        """Each prediction must expose the documented fields."""
        features = np.array([[60.0, 120.0, 2.0]])
        prediction = self.model.predict_bottleneck_delays(features)[0]
        assert set(prediction.keys()) == {
            "node_id",
            "congestion_score",
            "is_bottleneck_detected",
            "predicted_delay_mins",
        }

    def test_delay_is_score_times_25(self):
        """predicted_delay_mins = congestion_score * 25, rounded to 1dp."""
        features = np.array([[60.0, 120.0, 2.0]])
        prediction = self.model.predict_bottleneck_delays(features)[0]
        score = prediction["congestion_score"]
        assert np.isclose(prediction["predicted_delay_mins"], round(score * 25.0, 1))

    def test_congested_node_flagged_as_bottleneck(self):
        """A heavily congested node (low speed, high density) must exceed the 0.6 threshold."""
        features = np.array([[25.0, 450.0, 15.0], [60.0, 120.0, 2.0]])
        predictions = self.model.predict_bottleneck_delays(features)
        congested = next(p for p in predictions if p["node_id"] == 0)
        assert bool(congested["is_bottleneck_detected"]) is True
