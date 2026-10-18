import pytest
from unittest.mock import AsyncMock

pytest.importorskip("torch_geometric")

from routes import gnn_routes


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "endpoint_name",
    ["build_graph", "optimize_route", "multi_objective_optimize", "update_route"],
)
async def test_cpu_bound_gnn_endpoints_use_bounded_inference_executor(monkeypatch, endpoint_name):
    run_inference = AsyncMock(
        side_effect=lambda func, *args, **kwargs: {
            "nodes": 2,
            "edges": 0,
            "is_connected": False,
            "success": True,
            "route": [],
        }
    )
    monkeypatch.setattr(gnn_routes, "run_inference", run_inference)

    if endpoint_name == "build_graph":
        result = await gnn_routes.build_graph([gnn_routes.Node(id="a", lat=0, lng=0)], [])
    elif endpoint_name == "optimize_route":
        request = gnn_routes.RouteRequest(
            start_node="a",
            end_node="b",
            nodes=[
                gnn_routes.Node(id="a", lat=0, lng=0),
                gnn_routes.Node(id="b", lat=1, lng=1),
            ],
            edges=[],
        )
        result = await gnn_routes.optimize_route(request)
    elif endpoint_name == "multi_objective_optimize":
        request = gnn_routes.RouteRequest(
            start_node="a",
            end_node="b",
            nodes=[
                gnn_routes.Node(id="a", lat=0, lng=0),
                gnn_routes.Node(id="b", lat=1, lng=1),
            ],
            edges=[],
        )
        result = await gnn_routes.multi_objective_optimize(request)
    else:
        request = gnn_routes.RouteUpdateRequest(
            route=[{"from": "a", "to": "b"}],
            nodes=[
                gnn_routes.Node(id="a", lat=0, lng=0),
                gnn_routes.Node(id="b", lat=1, lng=1),
            ],
            edges=[
                gnn_routes.Edge(source="a", target="b", distance=1, time=1)
            ],
            traffic_data={},
        )
        result = await gnn_routes.update_route(request)

    assert result["success"] is True
    run_inference.assert_awaited_once()
    assert callable(run_inference.await_args.args[0])
