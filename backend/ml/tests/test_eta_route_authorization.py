import asyncio
import importlib
import sys
import types
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException


@pytest.fixture
def eta_routes(monkeypatch):
    fake_pipeline_module = types.ModuleType("services.traffic_pipeline")

    class FakeTrafficPipeline:
        def __init__(self, *args, **kwargs):
            self.get_real_time_traffic = AsyncMock()
            self.get_traffic_forecast = AsyncMock()
            self.train_model = lambda **kwargs: None

    fake_pipeline_module.TrafficPipeline = FakeTrafficPipeline
    fake_pipeline_module.eta_seconds_from_speed = lambda distance, speed: None

    fake_execution_module = types.ModuleType("app.execution")
    fake_execution_module.run_inference = AsyncMock()

    monkeypatch.setitem(sys.modules, "services.traffic_pipeline", fake_pipeline_module)
    monkeypatch.setitem(sys.modules, "app.execution", fake_execution_module)
    sys.modules.pop("routes.eta_routes", None)

    return importlib.import_module("routes.eta_routes")


def test_route_authorization_requires_order_route_id(eta_routes, monkeypatch):
    monkeypatch.setattr(
        eta_routes,
        "_order_is_assigned",
        lambda order_id: order_id == "ORDER-123",
    )

    assert eta_routes._route_is_authorized("order_ORDER-123") is True
    assert eta_routes._route_is_authorized("order_ORDER-999") is False
    assert eta_routes._route_is_authorized("ORDER-123") is False
    assert eta_routes._route_is_authorized("order_") is False


@pytest.mark.parametrize(
    ("endpoint_name", "route_id"),
    [
        ("get_traffic", "order_ORDER-999"),
        ("get_forecast", "order_ORDER-999"),
        ("get_traffic", "arbitrary-route-id"),
        ("get_forecast", "arbitrary-route-id"),
    ],
)
def test_eta_route_endpoints_reject_unauthorized_route(
    eta_routes, monkeypatch, endpoint_name, route_id
):
    monkeypatch.setattr(eta_routes, "_route_is_authorized", lambda _: False)
    handler = getattr(eta_routes, endpoint_name)

    with pytest.raises(HTTPException) as exc_info:
        if endpoint_name == "get_forecast":
            asyncio.run(handler(route_id, 1))
        else:
            asyncio.run(handler(route_id))

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Route not found"


@pytest.mark.parametrize("endpoint_name", ["get_traffic", "get_forecast"])
def test_eta_route_endpoints_delegate_authorized_route(
    eta_routes, monkeypatch, endpoint_name
):
    route_id = "order_ORDER-123"
    monkeypatch.setattr(eta_routes, "_route_is_authorized", lambda value: value == route_id)

    if endpoint_name == "get_traffic":
        expected = {"speed": 18.5, "congestion": 0.25}
        eta_routes.traffic_pipeline.get_real_time_traffic.return_value = expected
        result = asyncio.run(eta_routes.get_traffic(route_id))
        eta_routes.traffic_pipeline.get_real_time_traffic.assert_awaited_once_with(route_id)
    else:
        expected = {"forecast": 20.0, "confidence": "medium"}
        eta_routes.traffic_pipeline.get_traffic_forecast.return_value = expected
        result = asyncio.run(eta_routes.get_forecast(route_id, 2))
        eta_routes.traffic_pipeline.get_traffic_forecast.assert_awaited_once_with(route_id, 2)

    assert result["route_id"] == route_id
    assert result["data"] == expected
