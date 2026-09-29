from types import SimpleNamespace

import networkx as nx
import pytest

pytest.importorskip("torch_geometric")

from gnn.models import ParetoSearchLimitExceeded, RouteOptimizer
from routes import gnn_routes


def make_optimizer():
    return object.__new__(RouteOptimizer)


def make_graph_data():
    graph = nx.Graph()
    graph.add_edge("a", "b", time=1, cost=10, fuel=10, distance=1, congestion=0)
    graph.add_edge("b", "d", time=1, cost=10, fuel=10, distance=1, congestion=0)
    graph.add_edge("a", "c", time=4, cost=1, fuel=1, distance=4, congestion=0)
    graph.add_edge("c", "d", time=4, cost=1, fuel=1, distance=4, congestion=0)
    return SimpleNamespace(graph=graph)


def test_exact_pareto_frontier_remains_unchanged_for_small_graphs():
    optimizer = make_optimizer()
    frontier = optimizer._find_pareto_routes(
        "a", "d", make_graph_data(), ["time", "cost"]
    )

    assert len(frontier) == 2
    assert {
        (route["total_time"], route["total_cost"])
        for route in frontier
    } == {(2, 20), (8, 2)}

    metrics = optimizer.get_pareto_metrics()
    assert metrics["frontier_size"] == 2
    assert metrics["labels_expanded"] > 0
    assert metrics["labels_stored"] >= 1


def test_per_node_label_budget_stops_label_explosion():
    optimizer = make_optimizer()
    with pytest.raises(ParetoSearchLimitExceeded, match="label limit exceeded"):
        optimizer._find_pareto_routes(
            "a", "d", make_graph_data(), ["time", "cost"],
            constraints={"max_pareto_labels_per_node": 1},
        )


def test_total_label_budget_stops_global_memory_growth():
    optimizer = make_optimizer()
    with pytest.raises(ParetoSearchLimitExceeded, match="label budget exceeded"):
        optimizer._find_pareto_routes(
            "a", "d", make_graph_data(), ["time", "cost"],
            constraints={"max_pareto_labels": 2},
        )


def test_expansion_budget_stops_unbounded_search_work():
    optimizer = make_optimizer()
    with pytest.raises(ParetoSearchLimitExceeded, match="expansion limit exceeded"):
        optimizer._find_pareto_routes(
            "a", "d", make_graph_data(), ["time", "cost"],
            constraints={"max_pareto_expansions": 1},
        )


@pytest.mark.asyncio
async def test_api_returns_503_when_pareto_budget_is_exceeded(monkeypatch):
    def raise_budget(*_args, **_kwargs):
        raise ParetoSearchLimitExceeded("Pareto search label budget exceeded")

    monkeypatch.setattr(
        gnn_routes.optimizer,
        "_find_pareto_routes",
        raise_budget,
    )

    request = gnn_routes.RouteRequest(
        start_node="a",
        end_node="d",
        nodes=[
            gnn_routes.Node(id="a", lat=0, lng=0),
            gnn_routes.Node(id="d", lat=1, lng=1),
        ],
        edges=[],
    )

    with pytest.raises(Exception) as exc_info:
        await gnn_routes.multi_objective_optimize(request)

    assert getattr(exc_info.value, "status_code", None) == 503
