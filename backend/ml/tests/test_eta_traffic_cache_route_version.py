import sys
from unittest.mock import AsyncMock, MagicMock

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

from routes import eta_routes


@pytest.mark.asyncio
async def test_get_traffic_uses_current_order_destination_version(monkeypatch):
    pipeline = MagicMock()
    pipeline.get_real_time_traffic = AsyncMock(
        return_value={
            "speed": 20.0,
            "congestion": 0.2,
            "route_signature": eta_routes.TrafficPipeline.build_route_signature({
                "lat": 14.0,
                "lng": 79.0,
            }),
        }
    )

    monkeypatch.setattr(eta_routes, "traffic_pipeline", pipeline)
    monkeypatch.setattr(eta_routes, "_order_is_assigned", lambda _: True)
    monkeypatch.setattr(
        eta_routes,
        "_get_order_route",
        lambda _: {
            "source_lat": 12.0,
            "source_lng": 77.0,
            "dest_lat": 14.0,
            "dest_lng": 79.0,
        },
    )

    result = await eta_routes.get_traffic("order_123")

    expected_signature = eta_routes.TrafficPipeline.build_route_signature({
        "lat": 14.0,
        "lng": 79.0,
    })
    assert result["route_id"] == "order_123"
    pipeline.get_real_time_traffic.assert_awaited_once_with(
        "order_123",
        expected_signature,
    )
