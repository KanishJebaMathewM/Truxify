"""Invalid predicted speeds must select routing duration rather than invalid ETA."""
import importlib.util
import math
from collections import OrderedDict
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.traffic_pipeline import TrafficPipeline, eta_seconds_from_speed


@pytest.mark.parametrize("distance,speed", [
    (math.nan, 10), (1000, math.nan), (math.inf, 10), (1000, math.inf),
    (1e308, 1e-308), (1e-308, 1e308), (0, 10), (-1, 10),
    (1000, 0), (1000, -1), (None, 10), (1000, None),
])
def test_invalid_or_unrepresentable_travel_time_requests_fallback(distance, speed):
    assert eta_seconds_from_speed(distance, speed) is None


@pytest.mark.parametrize("distance,speed,expected", [(1000, 10, 100), (1.5, 0.5, 3)])
def test_valid_seconds_conversion_is_preserved(distance, speed, expected):
    assert eta_seconds_from_speed(distance, speed) == expected


@pytest.fixture
def pipeline():
    # Actual predictor, rolling window and realtime update; no database/model
    # artifact or Redis connection. Only transport/model boundaries controlled.
    instance = TrafficPipeline.__new__(TrafficPipeline)
    instance._closed = True
    instance._route_windows = OrderedDict()
    instance._max_route_windows = 1000
    instance.model = SimpleNamespace(predict=Mock(return_value=np.array([[10.0]])))
    instance.redis = SimpleNamespace(setex=Mock())
    instance.ingest_traffic_data = AsyncMock(return_value=SimpleNamespace(
        traffic_speed=10, free_flow_speed=15, congestion_level=0.3))
    instance._fetch_osrm_data = AsyncMock(return_value={"distance": 1000, "duration": 600})
    return instance


@pytest.mark.asyncio
@pytest.mark.parametrize("distance,speed", [
    (1000, math.inf), (math.inf, 10), (1e308, 1e-308),
    (1e-308, 1e308), (1000, math.nan),
])
async def test_realtime_update_uses_routing_duration_for_invalid_conversion(pipeline, distance, speed):
    pipeline.model.predict.return_value = np.array([[speed]])
    pipeline._fetch_osrm_data.return_value = {"distance": distance, "duration": 600}
    result = await pipeline.update_eta_realtime("order-one", {"lat": 0, "lng": 0}, {"lat": 1, "lng": 1})
    assert result["eta_seconds"] == 600
    assert result["eta_minutes"] == 10
    assert result["eta_string"] == "0:10:00"
    assert '"eta_seconds": 600.0' in pipeline.redis.setex.call_args.args[2]


@pytest.fixture
def route_app(monkeypatch, pipeline):
    monkeypatch.setenv("ML_API_KEY", "test-eta-key")
    monkeypatch.setattr(TrafficPipeline, "__init__", lambda self, *args: self.__dict__.update(pipeline.__dict__))
    path = Path(__file__).parents[1] / "routes" / "eta_routes.py"
    spec = importlib.util.spec_from_file_location("finite_eta_route_fixture", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "_get_order_route", lambda _: {
        "source_lat": 0, "source_lng": 0, "dest_lat": 1, "dest_lng": 1})
    app = FastAPI()
    app.include_router(module.router)
    return app


@pytest.mark.parametrize("distance,speed", [(1000, math.nan), (1000, math.inf), (math.inf, 10)])
def test_mounted_prediction_route_falls_back_instead_of_returning_500(route_app, pipeline, distance, speed):
    pipeline.model.predict.return_value = np.array([[speed]])
    pipeline._fetch_osrm_data.return_value = {"distance": distance, "duration": 600}
    with TestClient(route_app) as client:
        response = client.post("/eta/predict", headers={"X-API-Key": "test-eta-key"}, json={
            "order_id": "order-one", "source_lat": 0, "source_lng": 0, "dest_lat": 1, "dest_lng": 1})
    assert response.status_code == 200
    assert response.json()["eta_seconds"] == 600
    assert response.json()["eta_string"] == "0:10:00"
