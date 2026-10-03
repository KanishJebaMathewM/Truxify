import pytest

pytest.importorskip("torch_geometric")

from gnn.models import GraphNetworkBuilder, RouteOptimizer


def build_network(edges):
    builder = GraphNetworkBuilder()
    nodes = [
        {'id': 'A', 'lat': 12.97, 'lng': 77.59, 'traffic': 20, 'road_type': 'highway', 'speed_limit': 80},
        {'id': 'B', 'lat': 12.98, 'lng': 77.60, 'traffic': 30, 'road_type': 'arterial', 'speed_limit': 60},
        {'id': 'C', 'lat': 12.99, 'lng': 77.61, 'traffic': 10, 'road_type': 'highway', 'speed_limit': 80},
        {'id': 'D', 'lat': 13.00, 'lng': 77.62, 'traffic': 10, 'road_type': 'highway', 'speed_limit': 80},
    ]
    builder.build_road_network(nodes, edges)
    return builder.get_pytorch_data()


def test_real_time_update_reroutes_when_traffic_changes():
    graph_data = build_network([
        {'source': 'A', 'target': 'B', 'distance': 10.0, 'time': 10.0, 'cost': 50.0, 'fuel': 4.0, 'congestion': 0.1},
        {'source': 'B', 'target': 'C', 'distance': 10.0, 'time': 10.0, 'cost': 50.0, 'fuel': 4.0, 'congestion': 0.1},
        {'source': 'A', 'target': 'D', 'distance': 15.0, 'time': 15.0, 'cost': 80.0, 'fuel': 5.0, 'congestion': 0.1},
        {'source': 'D', 'target': 'C', 'distance': 15.0, 'time': 15.0, 'cost': 80.0, 'fuel': 5.0, 'congestion': 0.1},
    ])

    current_route = [
        {'from': 'A', 'to': 'B', 'distance': 10.0, 'time': 10.0, 'cost': 50.0, 'fuel': 4.0, 'congestion': 0.1},
        {'from': 'B', 'to': 'C', 'distance': 10.0, 'time': 10.0, 'cost': 50.0, 'fuel': 4.0, 'congestion': 0.1},
    ]

    optimizer = RouteOptimizer()
    updated_route = optimizer.real_time_update(
        current_route,
        {
            'A-B': {'time': 100.0, 'cost': 150.0, 'fuel': 8.0, 'congestion': 0.95},
        },
        graph_data=graph_data,
        objectives=['time'],
    )

    hops = [(edge['from'], edge['to']) for edge in updated_route]
    assert hops == [('A', 'D'), ('D', 'C')]
    assert current_route[0]['time'] == 10.0
    assert updated_route[0]['time'] == 15.0


def test_real_time_update_applies_route_updates_without_reoptimization_when_unchanged():
    graph_data = build_network([
        {'source': 'A', 'target': 'B', 'distance': 10.0, 'time': 10.0, 'cost': 50.0, 'fuel': 4.0, 'congestion': 0.1},
        {'source': 'B', 'target': 'C', 'distance': 10.0, 'time': 10.0, 'cost': 50.0, 'fuel': 4.0, 'congestion': 0.1},
    ])

    current_route = [
        {'from': 'A', 'to': 'B', 'distance': 10.0, 'time': 10.0, 'cost': 50.0, 'fuel': 4.0, 'congestion': 0.1},
        {'from': 'B', 'to': 'C', 'distance': 10.0, 'time': 10.0, 'cost': 50.0, 'fuel': 4.0, 'congestion': 0.1},
    ]

    optimizer = RouteOptimizer()
    updated_route = optimizer.real_time_update(
        current_route,
        {'A-B': {'time': 10.0, 'cost': 50.0, 'congestion': 0.1}},
        graph_data=graph_data,
    )

    assert updated_route == current_route
    assert updated_route is not current_route
