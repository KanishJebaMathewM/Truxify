import pytest
import networkx as nx

torch_geometric = pytest.importorskip("torch_geometric")
from gnn.models import GraphNetworkBuilder, RouteOptimizer


def build_network(edges):
    builder = GraphNetworkBuilder()
    nodes = [
        {'id': 'A', 'lat': 12.97, 'lng': 77.59, 'traffic': 20, 'road_type': 'highway', 'speed_limit': 80},
        {'id': 'B', 'lat': 12.98, 'lng': 77.60, 'traffic': 30, 'road_type': 'arterial', 'speed_limit': 60},
        {'id': 'C', 'lat': 12.99, 'lng': 77.61, 'traffic': 10, 'road_type': 'highway', 'speed_limit': 80},
    ]
    builder.build_road_network(nodes, edges)
    return builder, builder.get_pytorch_data()


def test_road_network_preserves_edge_direction():
    builder, graph_data = build_network([
        {'source': 'A', 'target': 'B', 'distance': 10.0, 'time': 10.0},
        {'source': 'B', 'target': 'C', 'distance': 10.0, 'time': 10.0},
    ])

    assert isinstance(builder.graph, nx.DiGraph)
    assert builder.graph.has_edge('A', 'B')
    assert builder.graph.has_edge('B', 'C')
    assert not builder.graph.has_edge('B', 'A')
    assert not builder.graph.has_edge('C', 'B')

    node_map = graph_data.node_map
    edges = {
        (node_map[u], node_map[v])
        for u, v in builder.graph.edges()
    }
    assert edges == set(map(tuple, graph_data.edge_index.t().tolist()))


def test_route_optimizer_does_not_traverse_one_way_roads_backwards():
    _, graph_data = build_network([
        {'source': 'A', 'target': 'B', 'distance': 10.0, 'time': 10.0},
        {'source': 'B', 'target': 'C', 'distance': 10.0, 'time': 10.0},
    ])

    optimizer = RouteOptimizer()
    forward = optimizer.optimize_route('A', 'C', graph_data, objectives=['time'])
    reverse = optimizer.optimize_route('C', 'A', graph_data, objectives=['time'])

    assert forward is not None
    assert forward['route'][0]['from'] == 'A'
    assert forward['route'][-1]['to'] == 'C'
    assert reverse is None


def test_reverse_traversal_requires_explicit_reverse_edge():
    _, graph_data = build_network([
        {'source': 'A', 'target': 'B', 'distance': 10.0, 'time': 10.0},
        {'source': 'B', 'target': 'A', 'distance': 12.0, 'time': 12.0},
    ])

    optimizer = RouteOptimizer()
    reverse = optimizer.optimize_route('B', 'A', graph_data, objectives=['time'])

    assert reverse is not None
    assert reverse['route'] == [
        {
            'from': 'B',
            'to': 'A',
            'distance': 12.0,
            'time': 12.0,
            'cost': 0,
            'fuel': 0,
            'congestion': 0,
        }
    ]
