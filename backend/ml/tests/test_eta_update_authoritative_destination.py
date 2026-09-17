import os
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

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("ML_API_KEY", "test-key")

from routes import eta_routes


@pytest.fixture
def mocked_eta_pipeline(monkeypatch):
    pipeline = MagicMock()
    pipeline.update_eta_realtime = AsyncMock(return_value={"eta_minutes": 10})
    monkeypatch.setattr(eta_routes, "traffic_pipeline", pipeline)
    monkeypatch.setattr(eta_routes, "_order_is_assigned", lambda _: True)
    return pipeline


@pytest.mark.asyncio
async def test_update_eta_uses_server_authoritative_destination(
    mocked_eta_pipeline,
    monkeypatch,
):
    monkeypatch.setattr(
        eta_routes,
        "_get_order_route",
        lambda _: {
            "source_lat": 12.0,
            "source_lng": 77.0,
            "dest_lat": 13.0,
            "dest_lng": 78.0,
        },
    )

    request = eta_routes.ETAUpdateRequest(
        current_lat=12.1,
        current_lng=77.1,
        dest_lat=40.0,
        dest_lng=-73.0,
    )

    result = await eta_routes.update_eta("order-123", request)

    assert result["order_id"] == "order-123"
    mocked_eta_pipeline.update_eta_realtime.assert_awaited_once_with(
        "order-123",
        {"lat": 12.1, "lng": 77.1},
        {"lat": 13.0, "lng": 78.0},
    )


@pytest.mark.asyncio
async def test_update_eta_rejects_orders_without_route_coordinates(
    mocked_eta_pipeline,
    monkeypatch,
):
    monkeypatch.setattr(eta_routes, "_get_order_route", lambda _: None)

    request = eta_routes.ETAUpdateRequest(
        current_lat=12.1,
        current_lng=77.1,
        dest_lat=40.0,
        dest_lng=-73.0,
    )

    with pytest.raises(eta_routes.HTTPException) as exc_info:
        await eta_routes.update_eta("order-123", request)

    assert exc_info.value.status_code == 404
    mocked_eta_pipeline.update_eta_realtime.assert_not_awaited()
