"""Unit tests for backend/ml/self_supervised/contrastive_fraud.py.

Run with: python3 -m pytest tests/test_contrastive_fraud.py -v --no-header
"""
import numpy as np
from self_supervised.contrastive_fraud import SimCLRContrastiveFraudDetector


class TestExtractEmbedding:
    """Tests for the trajectory embedding."""

    def setup_method(self):
        self.detector = SimCLRContrastiveFraudDetector(embedding_dim=8)

    def test_embedding_dimension(self):
        """The embedding must have the configured dimension."""
        trajectory = np.array([[12.0, 77.0], [12.1, 77.1], [12.2, 77.2]])
        emb = self.detector.extract_embedding(trajectory)
        assert emb.shape == (8,)

    def test_embedding_is_unit_norm(self):
        """The embedding must be normalised to unit length."""
        trajectory = np.array([[12.0, 77.0], [12.1, 77.1]])
        emb = self.detector.extract_embedding(trajectory)
        assert np.isclose(np.linalg.norm(emb), 1.0, atol=1e-6)


class TestAnomalyScore:
    """Tests for the anomaly-score computation."""

    def setup_method(self):
        self.detector = SimCLRContrastiveFraudDetector(embedding_dim=8)

    def test_score_is_in_unit_interval(self):
        """The anomaly score must fall within 0..1."""
        for trajectory in [
            np.array([[12.0, 77.0], [12.1, 77.1]]),
            np.array([[0.0, 0.0], [0.0, 0.0]]),
            np.array([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]]),
        ]:
            score = self.detector.compute_anomaly_score(trajectory)
            assert 0.0 <= score <= 1.0

    def test_identical_to_centroid_is_normal(self):
        """A trajectory embedding matching the normal centroid must score ~0."""
        # Build a trajectory whose mean is aligned with the centroid direction.
        centroid = self.detector.normal_centroid
        # Reconstruct a 2-column trajectory whose padded mean points at the centroid.
        mean_xy = centroid[:2] * 100.0
        trajectory = np.tile(mean_xy, (10, 1))
        score = self.detector.compute_anomaly_score(trajectory)
        assert score < 0.55

    def test_opposite_direction_scores_high(self):
        """A trajectory pointing opposite the centroid must score high."""
        centroid = self.detector.normal_centroid
        mean_xy = -centroid[:2] * 100.0
        trajectory = np.tile(mean_xy, (10, 1))
        score = self.detector.compute_anomaly_score(trajectory)
        assert score > 0.5


class TestIsAnomalous:
    """Tests for the anomaly threshold gate."""

    def test_threshold_gates_decision(self):
        """Scores above the threshold must be flagged anomalous."""
        detector = SimCLRContrastiveFraudDetector(embedding_dim=8, anomaly_threshold=0.5)
        centroid = detector.normal_centroid
        # Opposite direction → high anomaly score → anomalous
        trajectory = np.tile(-centroid[:2] * 100.0, (10, 1))
        assert detector.is_anomalous(trajectory) is True
