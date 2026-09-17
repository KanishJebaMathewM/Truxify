import sys
from unittest.mock import AsyncMock, MagicMock

import numpy as np
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

from services import traffic_pipeline as traffic_pipeline_module
from services.traffic_pipeline import TrafficPipeline


@pytest.mark.asyncio
async def test_update_eta_uses_bounded_inference_executor(monkeypatch):
    pipeline = TrafficPipeline.__new__(TrafficPipeline)
    pipeline.ingest_traffic_data = AsyncMock(
        return_value=MagicMock(
            traffic_speed=20.0,
            free_flow_speed=25.0,
            congestion_level=0.2,
        )
    )
    pipeline.predict_eta = MagicMock(return_value=999.0)
    pipeline._fetch_osrm_data = AsyncMock(
        return_value={"distance": 20000.0, "duration": 1200.0}
    )
    pipeline.redis = MagicMock()
    pipeline.redis.setex = MagicMock()

    captured = {}

    async def fake_run_inference(func, *args, **kwargs):
        captured["func"] = func
        captured["args"] = args
        captured["kwargs"] = kwargs
        return 20.0

    monkeypatch.setattr(traffic_pipeline_module, "run_inference", fake_run_inference)

    result = await pipeline.update_eta_realtime(
        "order-123",
        {"lat": 12.1, "lng": 77.1},
        {"lat": 13.0, "lng": 78.0},
    )

    assert result["eta_seconds"] == 1000.0
    assert captured["func"] is pipeline.predict_eta
    np.testing.assert_array_equal(
        captured["args"][0],
        np.array([[20.0, 25.0, 0.2, captured["args"][0][0, 3], captured["args"][0][0, 4]]]),
    )
    assert captured["args"][1] == "order_order-123"
    pipeline.predict_eta.assert_not_called()


@pytest.mark.asyncio
async def test_update_eta_propagates_inference_backpressure(monkeypatch):
    pipeline = TrafficPipeline.__new__(TrafficPipeline)
    pipeline.ingest_traffic_data = AsyncMock(
        return_value=MagicMock(
            traffic_speed=20.0,
            free_flow_speed=25.0,
            congestion_level=0.2,
        )
    )
    pipeline.predict_eta = MagicMock(return_value=999.0)
    pipeline._fetch_osrm_data = AsyncMock(
        return_value={"distance": 20000.0, "duration": 1200.0}
    )
    pipeline.redis = MagicMock()
    pipeline.redis.setex = MagicMock()

    async def reject_inference(*args, **kwargs):
        raise RuntimeError("inference capacity exhausted")

    monkeypatch.setattr(traffic_pipeline_module, "run_inference", reject_inference)

    result = await pipeline.update_eta_realtime(
        "order-123",
        {"lat": 12.1, "lng": 77.1},
        {"lat": 13.0, "lng": 78.0},
    )

    assert result is None
    pipeline.predict_eta.assert_not_called()
