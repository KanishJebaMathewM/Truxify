import pytest
import numpy as np
from unittest.mock import MagicMock, patch

from anomaly.detector import AnomalyDetector
from anomaly.models import LSTMAutoencoder

class TestLSTMAutoencoder:
    def test_build_model_without_tensorflow(self):
        ae = LSTMAutoencoder(input_dim=5, sequence_length=10)
        assert ae.input_dim == 5
        assert ae.sequence_length == 10

class TestAnomalyDetector:
    @patch("redis.Redis.from_url")
    def test_init_anomaly_detector(self, mock_redis):
        detector = AnomalyDetector()
        assert "driver_behavior" in detector.models
        assert "transactions" in detector.models
        assert "gps_tracking" in detector.models

    @patch("redis.Redis.from_url")
    def test_detect_anomaly_fallback(self, mock_redis):
        detector = AnomalyDetector()
        sample_data = np.random.randn(60, 10)
        # Verify call handles inputs smoothly
        score, severity = detector.detect_anomaly("driver_behavior", sample_data)
        assert isinstance(score, (float, int, np.floating))
        assert severity in ["low", "medium", "high", "none"]
