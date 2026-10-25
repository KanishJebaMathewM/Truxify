import json
import sys
from unittest.mock import MagicMock

import pytest

mock_tf = MagicMock()
mock_tf.keras = MagicMock()
mock_tf.keras.models = MagicMock()
mock_tf.keras.layers = MagicMock()
mock_tf.keras.optimizers = MagicMock()
mock_tf.keras.models.load_model = MagicMock()
mock_tf.keras.optimizers.Adam = MagicMock()

sys.modules["tensorflow"] = mock_tf
sys.modules["tensorflow.keras"] = mock_tf.keras
sys.modules["tensorflow.keras.models"] = mock_tf.keras.models
sys.modules["tensorflow.keras.layers"] = mock_tf.keras.layers
sys.modules["tensorflow.keras.optimizers"] = mock_tf.keras.optimizers

from services.traffic_pipeline import TrafficPipeline


def make_pipeline():
    pipeline = object.__new__(TrafficPipeline)
    pipeline.redis = MagicMock()
    return pipeline


@pytest.mark.asyncio
async def test_cache_lookup_uses_requested_route_version():
    pipeline = make_pipeline()
    old_destination = {"lat": 13.0, "lng": 78.0}
    new_destination = {"lat": 14.0, "lng": 79.0}
    old_signature = pipeline.build_route_signature(old_destination)
    new_signature = pipeline.build_route_signature(new_destination)

    pipeline.redis.get.return_value = json.dumps({
        "speed": 20.0,
        "congestion": 0.2,
        "timestamp": "2026-09-17T00:00:00",
        "route_signature": old_signature,
    }).encode()

    traffic = await pipeline.get_real_time_traffic("order_123", new_signature)

    assert traffic is None
    pipeline.redis.get.assert_called_once_with(
        f"traffic:order_123:{new_signature}"
    )


@pytest.mark.asyncio
async def test_cache_hit_accepts_matching_route_version():
    pipeline = make_pipeline()
    destination = {"lat": 13.0, "lng": 78.0}
    signature = pipeline.build_route_signature(destination)
    cached = {
        "speed": 20.0,
        "congestion": 0.2,
        "timestamp": "2026-09-17T00:00:00",
        "route_signature": signature,
    }
    pipeline.redis.get.return_value = json.dumps(cached).encode()

    traffic = await pipeline.get_real_time_traffic("order_123", signature)

    assert traffic == cached
    pipeline.redis.get.assert_called_once_with(
        f"traffic:order_123:{signature}"
    )
