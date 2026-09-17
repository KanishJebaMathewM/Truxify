import pytest

pytest.importorskip("torch_geometric")

from gnn.models import GraphNetworkBuilder, RouteOptimizer


def test_unrelated_traffic_update_does_not_trigger_reoptimization():
    builder = GraphNetworkBuilder()
    nodes = [
        {"id": node, "lat": 12.0, "lng": 77.0}
        for node in ["A", "B", "C", "X", "Y"]
    ]
    edges = [
        {"source": "A", "target": "B", "distance": 10, "time": 10, "cost": 1, "fuel": 1, "congestion": 0.1},
        {"source": "B", "target": "C", "distance": 10, "time": 10, "cost": 1, "fuel": 1, "congestion": 0.1},
        {"source": "X", "target": "Y", "distance": 10, "time": 10, "cost": 1, "fuel": 1, "congestion": 0.1},
    ]
    builder.build_road_network(nodes, edges)
    graph_data = builder.get_pytorch_data()

    current_route = [
        {"from": "A", "to": "B", "distance": 10, "time": 10, "cost": 1, "fuel": 1, "congestion": 0.1},
        {"from": "B", "to": "C", "distance": 10, "time": 10, "cost": 1, "fuel": 1, "congestion": 0.1},
    ]

    optimizer = RouteOptimizer()
    optimizer._reoptimize = lambda *args, **kwargs: pytest.fail(
        "unrelated traffic updates must not trigger route reoptimization"
    )

    updated_route = optimizer.real_time_update(
        current_route,
        {"X-Y": {"time": 1000, "cost": 1000, "fuel": 1000, "congestion": 1.0}},
        graph_data=graph_data,
        objectives=["time"],
    )

    assert updated_route == current_route
    assert updated_route is not current_route
