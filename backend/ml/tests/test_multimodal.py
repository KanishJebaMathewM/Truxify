import json
import pytest
from unittest.mock import patch, MagicMock

from multimodal.sensor_fusion import SensorFusion

class TestMultimodal:
    @patch("redis.Redis.from_url")
    def test_sensor_fusion_init(self, mock_redis):
        engine = SensorFusion()
        assert engine is not None
        assert hasattr(engine, 'weights')


def _make_fusion(redis_get_result=None):
    """Build a SensorFusion backed by a fake Redis with a stubbed get()."""
    fake_redis = MagicMock()
    fake_redis.get.return_value = redis_get_result
    with patch("redis.Redis.from_url", return_value=fake_redis):
        return SensorFusion(), fake_redis


class TestFuseDataDeterministic:
    """fuse_data must be deterministic given real, fixed sensor payloads."""

    def test_safe_sensor_payload_returns_safe(self):
        engine, _ = _make_fusion()
        sensor = {
            'speed': 60.0,
            'acceleration': 2.0,
            'steering_angle': 10.0,
            'seatbelt': True,
        }
        report = engine.fuse_data({}, {}, sensor)
        assert report['sensor_risk'] == 0.0
        assert report['alert_level'] == 'SAFE'

    def test_risky_sensor_payload_returns_critical(self):
        engine, _ = _make_fusion()
        sensor = {
            'speed': 95.0,        # > 80 -> +0.2
            'acceleration': 7.0,  # |a| > 5 -> +0.2
            'steering_angle': 40.0,  # |angle| > 30 -> +0.1
            'seatbelt': False,    # -> +0.3
        }
        report = engine.fuse_data({}, {}, sensor)
        assert report['sensor_risk'] == pytest.approx(0.8)
        # sensor weight is 0.2, so fused = 0.8 * 0.2 = 0.16 -> SAFE without
        # vision/audio. With matching vision/audio risk it crosses CRITICAL.
        assert report['fusion_risk'] == pytest.approx(0.16)

    def test_risky_sensor_plus_vision_audio_raises_level(self):
        engine, _ = _make_fusion()
        vision = {'drowsiness': {'status': 'DROWSY'}, 'distraction': {'status': 'DISTRACTED'}}
        audio = {'emergency': {'is_emergency': True}}
        sensor = {
            'speed': 95.0,
            'acceleration': 7.0,
            'steering_angle': 40.0,
            'seatbelt': False,
        }
        report = engine.fuse_data(vision, audio, sensor)
        assert report['sensor_risk'] == pytest.approx(0.8)
        # vision 0.7*0.5 + audio 0.4*0.3 + sensor 0.8*0.2 = 0.63 -> WARNING.
        # Deterministic: the same payload always yields the same level.
        assert report['fusion_risk'] == pytest.approx(0.63)
        assert report['alert_level'] == 'WARNING'


class TestGetSafetyReportNoSynthesis:
    """get_safety_report must never fabricate sensor inputs."""

    def test_no_data_returns_unknown(self):
        engine, _ = _make_fusion(redis_get_result=None)
        report = engine.get_safety_report()
        assert report['alert_level'] == 'UNKNOWN'
        assert report['data_available'] is False
        assert report['fusion_risk'] == 0.0

    def test_uses_real_sensor_frame_from_redis(self):
        sensor = {
            'speed': 60.0,
            'acceleration': 2.0,
            'steering_angle': 10.0,
            'seatbelt': True,
        }
        engine, _ = _make_fusion(redis_get_result=json.dumps(sensor))
        report = engine.get_safety_report()
        assert report['data_available'] is True
        assert report['components']['sensors']['speed'] == 60.0
        assert report['alert_level'] in ('SAFE', 'WARNING', 'CRITICAL')
        # No random synthesis: components reflect exactly the stored frame.
        assert report['components']['sensors'] == sensor
