import importlib
import sys
from unittest.mock import AsyncMock, MagicMock

import numpy as np
import pytest


@pytest.fixture
def traffic_pipeline_context():
    """Load TrafficPipeline with isolated TensorFlow and services module state."""
    tensorflow_names = {
        "tensorflow",
        "tensorflow.keras",
        "tensorflow.keras.models",
        "tensorflow.keras.layers",
        "tensorflow.keras.optimizers",
    }
    saved_modules = {
        name: module
        for name, module in sys.modules.items()
        if name in tensorflow_names or name == "services" or name.startswith("services.")
    }

    for name in list(saved_modules):
        sys.modules.pop(name, None)

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

    try:
        traffic_pipeline_module = importlib.import_module("services.traffic_pipeline")
        yield traffic_pipeline_module, traffic_pipeline_module.TrafficPipeline
    finally:
        for name in list(sys.modules):
            if (
                name in tensorflow_names
                or name == "services"
                or name.startswith("services.")
            ):
                sys.modules.pop(name, None)
        sys.modules.update(saved_modules)


@pytest.mark.asyncio
async def test_update_eta_uses_bounded_inference_executor(traffic_pipeline_context, monkeypatch):
    """Verify ETA inference is delegated to the bounded worker executor."""
    traffic_pipeline_module, TrafficPipeline = traffic_pipeline_context
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
        """Capture the executor callable and its ETA prediction arguments."""
        captured["func"] = func
        captured["args"] = args
        captured["kwargs"] = kwargs
        return await _run_captured_inference(func, *args, **kwargs)

    async def _run_captured_inference(func, *args, **kwargs):
        """Invoke the submitted callable without calling predict_eta directly."""
        loop = __import__("asyncio").get_running_loop()
        return await loop.run_in_executor(None, lambda: func(*args, **kwargs))

    monkeypatch.setattr(traffic_pipeline_module, "run_inference", fake_run_inference)

    result = await pipeline.update_eta_realtime(
        "order-123",
        {"lat": 12.1, "lng": 77.1},
        {"lat": 13.0, "lng": 78.0},
    )

    assert result["eta_seconds"] == 1000.0
    assert captured["func"].__name__ == "_run_serialized_predict_eta"
    assert captured["args"][0] is pipeline
    np.testing.assert_array_equal(
        captured["args"][1],
        np.array([[20.0, 25.0, 0.2, captured["args"][1][0, 3], captured["args"][1][0, 4]]]),
    )
    assert captured["args"][2] == "order_order-123"
    pipeline.predict_eta.assert_called_once()


@pytest.mark.asyncio
async def test_update_eta_propagates_inference_backpressure(
    traffic_pipeline_context, monkeypatch
):
    """Verify inference-capacity failures return without a blocking fallback."""
    traffic_pipeline_module, TrafficPipeline = traffic_pipeline_context
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
        """Simulate an exhausted inference pool."""
        raise RuntimeError("inference capacity exhausted")

    monkeypatch.setattr(traffic_pipeline_module, "run_inference", reject_inference)

    result = await pipeline.update_eta_realtime(
        "order-123",
        {"lat": 12.1, "lng": 77.1},
        {"lat": 13.0, "lng": 78.0},
    )

    assert result is None
    pipeline.predict_eta.assert_not_called()
