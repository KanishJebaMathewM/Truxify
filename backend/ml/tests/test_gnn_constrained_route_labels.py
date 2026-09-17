import numpy as np
import pytest

pytest.importorskip("torch_geometric")

from gnn.models import GraphNetworkBuilder, RouteOptimizer


def test_constrained_search_keeps_incomparable_score_time_labels():
    builder = GraphNetworkBuilder()
    nodes = [
        {"id": node, "lat": 12.0, "lng": 77.0}
        for node in ["S", "A", "B", "X", "E"]
    ]
    edges = [
        {"source": "S", "target": "A", "distance": 1, "time": 5, "cost": 1},
        {"source": "A", "target": "X", "distance": 1, "time": 0, "cost": 1},
        {"source": "S", "target": "B", "distance": 1, "time": 2, "cost": 2},
        {"source": "B", "target": "X", "distance": 1, "time": 0, "cost": 2},
        {"source": "X", "target": "E", "distance": 1, "time": 1, "cost": 1},
    ]
    builder.build_road_network(nodes, edges)
    graph_data = builder.get_pytorch_data()
    embeddings = np.zeros((len(graph_data.node_map), 4), dtype=float)

    route = RouteOptimizer()._find_optimal_route(
        "S",
        "E",
        embeddings,
        graph_data,
        ["cost"],
        {"max_time": 6},
    )

    assert [(edge["from"], edge["to"]) for edge in route] == [
        ("S", "A"),
        ("A", "X"),
        ("X", "E"),
    ]
    assert sum(edge["cost"] for edge in route) == 3
    assert sum(edge["time"] for edge in route) == 6
