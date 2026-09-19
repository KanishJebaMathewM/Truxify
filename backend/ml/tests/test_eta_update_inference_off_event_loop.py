import asyncio
import importlib
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
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
        loop = asyncio.get_running_loop()
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


def test_predict_eta_serializes_same_pipeline_calls(traffic_pipeline_context):
    """Verify concurrent worker calls for one pipeline are serialized."""
    pipeline_module, TrafficPipeline = traffic_pipeline_context
    pipeline = TrafficPipeline.__new__(TrafficPipeline)

    state_lock = threading.Lock()
    first_call_entered = threading.Event()
    active_calls = 0
    peak_calls = 0

    def predict_eta(features, route_id=None, route_signature=None):
        """Track concurrent prediction calls while simulating model work."""
        nonlocal active_calls, peak_calls
        with state_lock:
            active_calls += 1
            peak_calls = max(peak_calls, active_calls)
            first_call_entered.set()
        time.sleep(0.05)
        with state_lock:
            active_calls -= 1
        return 20.0

    pipeline.predict_eta = predict_eta
    serialized_predict = sys.modules["services._eta_inference_off_event_loop_patch"]._run_serialized_predict_eta

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(
            serialized_predict,
            pipeline,
            np.zeros((1, 5)),
            "order-1",
            "route-1",
        )
        assert first_call_entered.wait(timeout=1)
        second = executor.submit(
            serialized_predict,
            pipeline,
            np.zeros((1, 5)),
            "order-2",
            "route-2",
        )

        assert first.result(timeout=1) == 20.0
        assert second.result(timeout=1) == 20.0

    assert peak_calls == 1


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
