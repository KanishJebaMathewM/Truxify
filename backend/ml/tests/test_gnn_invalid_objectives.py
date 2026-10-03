import asyncio

import pytest
from fastapi import HTTPException

from routes.gnn_routes import (
    Edge,
    Node,
    RouteRequest,
    SUPPORTED_ROUTE_OBJECTIVES,
    multi_objective_optimize,
    optimize_route,
    validate_route_objectives,
)


def make_request(objectives):
    return RouteRequest(
        start_node="A",
        end_node="B",
        nodes=[
            Node(id="A", lat=0.0, lng=0.0),
            Node(id="B", lat=1.0, lng=1.0),
        ],
        edges=[
            Edge(source="A", target="B", distance=1.0, time=1.0),
        ],
        objectives=objectives,
    )


def test_supported_objectives_are_accepted():
    validate_route_objectives(sorted(SUPPORTED_ROUTE_OBJECTIVES))


def test_mixed_objectives_report_all_invalid_names():
    with pytest.raises(HTTPException) as exc_info:
        validate_route_objectives(["time", "invalid_one", "invalid_two", "invalid_one"])

    assert exc_info.value.status_code == 422
    assert "Unsupported route objective(s): 'invalid_one', 'invalid_two'." in exc_info.value.detail


def test_all_invalid_objectives_are_rejected():
    with pytest.raises(HTTPException) as exc_info:
        validate_route_objectives(["latency", "emissions"])

    assert exc_info.value.status_code == 422
    assert "latency" in exc_info.value.detail
    assert "emissions" in exc_info.value.detail
    for objective in sorted(SUPPORTED_ROUTE_OBJECTIVES):
        assert objective in exc_info.value.detail


def test_optimize_route_rejects_invalid_objective_before_processing():
    request = make_request(["time", "invalid_objective"])

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(optimize_route(request))

    assert exc_info.value.status_code == 422
    assert "invalid_objective" in exc_info.value.detail


def test_multi_objective_route_rejects_invalid_objective_before_processing():
    request = make_request(["unsupported_metric"])

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(multi_objective_optimize(request))

    assert exc_info.value.status_code == 422
    assert "unsupported_metric" in exc_info.value.detail
