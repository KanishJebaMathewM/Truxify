import pytest
from unittest.mock import patch, MagicMock

from multimodal.sensor_fusion import SensorFusion

class TestMultimodal:
    @patch("redis.Redis.from_url")
    def test_sensor_fusion_init(self, mock_redis):
        engine = SensorFusion()
        assert engine is not None
        assert hasattr(engine, 'weights')
