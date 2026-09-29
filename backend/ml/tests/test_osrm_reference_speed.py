from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.traffic_pipeline import TrafficPipeline


@pytest.mark.asyncio
async def test_osrm_reference_speed_matches_route_speed():
    pipeline = TrafficPipeline.__new__(TrafficPipeline)
    pipeline.osrm_url = "http://localhost:5000"
    pipeline.traffic_connect_timeout = 2
    pipeline.traffic_total_timeout = 5
    pipeline._osrm_failure_count = 0
    pipeline._osrm_circuit_open = False

    response = MagicMock()
    response.json = AsyncMock(
        return_value={"routes": [{"duration": 100.0, "distance": 1000.0}]}
    )

    session = MagicMock()
    session.get.return_value.__aenter__.return_value = response
    client = MagicMock()
    client.__aenter__ = AsyncMock(return_value=session)
    client.__aexit__ = AsyncMock(return_value=None)

    with patch("services.traffic_pipeline.aiohttp.ClientSession", return_value=client):
        result = await pipeline._fetch_osrm_data(
            {"lat": 12.0, "lng": 77.0},
            {"lat": 13.0, "lng": 78.0},
        )

    assert result["speed"] == pytest.approx(10.0)
    assert result["free_flow_speed"] == pytest.approx(10.0)
