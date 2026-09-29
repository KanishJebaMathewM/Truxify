import pytest

pytest.importorskip("torch_geometric")

from gnn.models import GraphNetworkBuilder, RouteOptimizer


def build_network(edges):
    builder = GraphNetworkBuilder()
    nodes = [
        {'id': node, 'lat': 12.0, 'lng': 77.0}
        for node in ['A', 'B', 'C', 'D']
    ]
    builder.build_road_network(nodes, edges)
    return builder.get_pytorch_data()


def test_realtime_reroute_starts_from_current_vehicle_node():
    graph_data = build_network([
        {'source': 'A', 'target': 'B', 'distance': 10.0, 'time': 10.0, 'cost': 50.0, 'fuel': 4.0, 'congestion': 0.1},
        {'source': 'B', 'target': 'C', 'distance': 10.0, 'time': 10.0, 'cost': 50.0, 'fuel': 4.0, 'congestion': 0.1},
        {'source': 'C', 'target': 'D', 'distance': 10.0, 'time': 10.0, 'cost': 50.0, 'fuel': 4.0, 'congestion': 0.1},
    ])

    current_route = [
        {'from': 'A', 'to': 'B', 'distance': 10.0, 'time': 10.0, 'cost': 50.0, 'fuel': 4.0, 'congestion': 0.1},
        {'from': 'B', 'to': 'C', 'distance': 10.0, 'time': 10.0, 'cost': 50.0, 'fuel': 4.0, 'congestion': 0.1},
        {'from': 'C', 'to': 'D', 'distance': 10.0, 'time': 10.0, 'cost': 50.0, 'fuel': 4.0, 'congestion': 0.1},
    ]

    optimizer = RouteOptimizer(allow_untrained=True)
    updated_route = optimizer.real_time_update(
        current_route,
        {'A-B': {'time': 100.0, 'cost': 150.0, 'fuel': 8.0, 'congestion': 0.95}},
        graph_data=graph_data,
        objectives=['time'],
        current_node='C',
    )

    assert [(edge['from'], edge['to']) for edge in updated_route] == [('C', 'D')]
