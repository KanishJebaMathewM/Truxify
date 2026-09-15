from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from routes import eta_routes


@pytest.mark.asyncio
async def test_predict_eta_uses_authoritative_order_coordinates():
    request = eta_routes.ETARequest(
        order_id="ORDER-123",
        source_lat=1.0,
        source_lng=2.0,
        dest_lat=3.0,
        dest_lng=4.0,
    )
    authoritative_route = {
        "source_lat": 28.6139,
        "source_lng": 77.2090,
        "dest_lat": 28.7041,
        "dest_lng": 77.1025,
    }
    traffic_data = SimpleNamespace(
        traffic_speed=12.0,
        free_flow_speed=15.0,
        congestion_level=0.2,
    )
    osrm_data = {"distance": 10000, "duration": 900}

    with patch.object(
        eta_routes,
        "_get_order_route",
        return_value=authoritative_route,
    ), patch.object(
        eta_routes.traffic_pipeline,
        "ingest_traffic_data",
        new=AsyncMock(return_value=traffic_data),
    ) as mock_ingest, patch.object(
        eta_routes,
        "run_inference",
        new=AsyncMock(return_value=20.0),
    ), patch.object(
        eta_routes.traffic_pipeline,
        "_fetch_osrm_data",
        new=AsyncMock(return_value=osrm_data),
    ) as mock_osrm:
        response = await eta_routes.predict_eta(request, None)

    assert response.order_id == request.order_id
    mock_ingest.assert_awaited_once_with(
        "order_ORDER-123",
        {"lat": authoritative_route["source_lat"], "lng": authoritative_route["source_lng"]},
        {"lat": authoritative_route["dest_lat"], "lng": authoritative_route["dest_lng"]},
    )
    mock_osrm.assert_awaited_once_with(
        {"lat": authoritative_route["source_lat"], "lng": authoritative_route["source_lng"]},
        {"lat": authoritative_route["dest_lat"], "lng": authoritative_route["dest_lng"]},
    )


@pytest.mark.asyncio
async def test_predict_eta_rejects_unknown_order_before_ingestion():
    request = eta_routes.ETARequest(
        order_id="UNKNOWN-ORDER",
        source_lat=28.6139,
        source_lng=77.2090,
        dest_lat=28.7041,
        dest_lng=77.1025,
    )

    with patch.object(
        eta_routes,
        "_get_order_route",
        return_value=None,
    ), patch.object(
        eta_routes.traffic_pipeline,
        "ingest_traffic_data",
        new=AsyncMock(),
    ) as mock_ingest:
        with pytest.raises(eta_routes.HTTPException) as exc_info:
            await eta_routes.predict_eta(request, None)

    assert exc_info.value.status_code == 404
    mock_ingest.assert_not_awaited()
