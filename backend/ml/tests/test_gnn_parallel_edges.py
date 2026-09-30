import pytest

pytest.importorskip("torch_geometric")

from gnn.models import GraphNetworkBuilder, RouteOptimizer


def _nodes():
    return [
        {'id': 'A', 'lat': 12.97, 'lng': 77.59, 'traffic': 0, 'road_type': 'arterial', 'speed_limit': 60},
        {'id': 'B', 'lat': 12.98, 'lng': 77.60, 'traffic': 0, 'road_type': 'arterial', 'speed_limit': 60},
    ]


def _parallel_edges():
    return [
        {'source': 'A', 'target': 'B', 'distance': 10.0, 'time': 20.0, 'cost': 100.0, 'fuel': 8.0, 'congestion': 0.2, 'hazmat_allowed': True, 'max_weight': 40.0},
        {'source': 'A', 'target': 'B', 'distance': 12.0, 'time': 8.0, 'cost': 250.0, 'fuel': 5.0, 'congestion': 0.1, 'hazmat_allowed': True, 'max_weight': 20.0},
    ]


def test_parallel_edges_are_preserved_in_road_graph():
    builder = GraphNetworkBuilder()
    graph = builder.build_road_network(_nodes(), _parallel_edges())

    assert graph.is_multigraph()
    assert graph.number_of_edges('A', 'B') == 2
    segment_data = list(graph.get_edge_data('A', 'B').values())
    assert {edge['time'] for edge in segment_data} == {8.0, 20.0}
    assert {edge['cost'] for edge in segment_data} == {100.0, 250.0}


def test_parallel_edges_are_all_exported_to_pytorch_data():
    builder = GraphNetworkBuilder()
    builder.build_road_network(_nodes(), _parallel_edges())
    graph_data = builder.get_pytorch_data()

    assert graph_data.edge_index.shape[1] == 2
    assert graph_data.edge_attr.shape == (2, 5)
    assert sorted(graph_data.edge_attr[:, 1].tolist()) == pytest.approx([0.08, 0.20])


def test_route_optimizer_selects_the_better_parallel_segment():
    builder = GraphNetworkBuilder()
    builder.build_road_network(_nodes(), _parallel_edges())
    graph_data = builder.get_pytorch_data()

    result = RouteOptimizer(allow_untrained=True).optimize_route(
        'A', 'B', graph_data, objectives=['time']
    )

    assert result is not None
    assert result['success'] is True
    assert len(result['route']) == 1
    assert result['route'][0]['from'] == 'A'
    assert result['route'][0]['to'] == 'B'
    assert result['route'][0]['time'] == 8.0
    assert result['route'][0]['cost'] == 250.0
    assert 'edge_key' in result['route'][0]


def test_route_optimizer_can_select_parallel_segment_by_constraint():
    builder = GraphNetworkBuilder()
    builder.build_road_network(_nodes(), _parallel_edges())
    graph_data = builder.get_pytorch_data()

    result = RouteOptimizer(allow_untrained=True).optimize_route(
        'A',
        'B',
        graph_data,
        objectives=['time'],
        constraints={'truck_weight': 30.0},
    )

    assert result is not None
    assert result['success'] is True
    assert result['route'][0]['time'] == 20.0
    assert result['route'][0]['cost'] == 100.0
    assert 'edge_key' in result['route'][0]
