import pytest


torch_geometric = pytest.importorskip("torch_geometric")
from gnn.models import GraphNetworkBuilder, RouteOptimizer


def build_graph():
    builder = GraphNetworkBuilder()
    builder.build_road_network(
        [
            {"id": "A", "lat": 12.97, "lng": 77.59},
            {"id": "B", "lat": 12.98, "lng": 77.60},
        ],
        [
            {"source": "A", "target": "B", "distance": 10.0, "time": 10.0},
        ],
    )
    return builder.get_pytorch_data()


def test_stale_route_edge_is_not_updated_from_traffic_data():
    graph_data = build_graph()
    optimizer = RouteOptimizer()
    current_route = [{
        "from": "B",
        "to": "C",
        "distance": 12.0,
        "time": 12.0,
        "cost": 10.0,
        "fuel": 5.0,
        "congestion": 0.1,
    }]
    traffic_data = {
        "B-C": {"time": 100.0, "cost": 90.0, "fuel": 20.0, "congestion": 0.9}
    }

    updated = optimizer.real_time_update(current_route, traffic_data, graph_data=graph_data)

    assert updated == current_route


def test_active_graph_edge_update_remains_supported():
    graph_data = build_graph()
    optimizer = RouteOptimizer()
    current_route = [{
        "from": "A",
        "to": "B",
        "distance": 10.0,
        "time": 10.0,
        "cost": 10.0,
        "fuel": 5.0,
        "congestion": 0.1,
    }]
    traffic_data = {
        "A-B": {"time": 20.0, "cost": 15.0, "fuel": 7.0, "congestion": 0.5}
    }

    updated = optimizer.real_time_update(current_route, traffic_data, graph_data=graph_data)

    assert updated[0]["time"] == 20.0
    assert updated[0]["cost"] == 15.0
    assert updated[0]["fuel"] == 7.0
    assert updated[0]["congestion"] == 0.5
