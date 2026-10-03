from unittest.mock import AsyncMock, MagicMock

import pytest

from services.traffic_pipeline import TrafficPipeline

_original_pipeline_init = TrafficPipeline.__init__
TrafficPipeline.__init__ = lambda self, db_url, redis_url: None
try:
    from routes import eta_routes
finally:
    TrafficPipeline.__init__ = _original_pipeline_init


@pytest.mark.asyncio
async def test_predict_eta_passes_authoritative_destination_route_version_to_model(monkeypatch):
    pipeline = MagicMock()
    pipeline.ingest_traffic_data = AsyncMock(
        return_value=MagicMock(
            traffic_speed=20.0,
            free_flow_speed=25.0,
            congestion_level=0.2,
        )
    )
    pipeline._fetch_osrm_data = AsyncMock(
        return_value={"distance": 20000.0, "duration": 1200.0}
    )

    run_inference = AsyncMock(return_value=20.0)
    monkeypatch.setattr(eta_routes, "traffic_pipeline", pipeline)
    monkeypatch.setattr(eta_routes, "run_inference", run_inference)
    monkeypatch.setattr(
        eta_routes,
        "_get_order_route",
        lambda _: {
            "source_lat": 28.6139,
            "source_lng": 77.2090,
            "dest_lat": 28.7041,
            "dest_lng": 77.1025,
        },
    )

    request = eta_routes.ETARequest(
        order_id="order-123",
        source_lat=12.0,
        source_lng=77.0,
        dest_lat=13.0,
        dest_lng=78.0,
    )

    result = await eta_routes.predict_eta(request)

    expected_signature = eta_routes.TrafficPipeline.build_route_signature({
        'lat': 28.7041,
        'lng': 77.1025,
    })
    assert result.order_id == "order-123"
    run_inference.assert_awaited_once_with(
        pipeline.predict_eta,
        run_inference.call_args.args[1],
        "order_order-123",
        expected_signature,
    )
    pipeline.ingest_traffic_data.assert_awaited_once_with(
        "order_order-123",
        {"lat": 28.6139, "lng": 77.2090},
        {"lat": 28.7041, "lng": 77.1025},
    )
