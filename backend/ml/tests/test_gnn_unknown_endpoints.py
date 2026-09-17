import pytest

pytest.importorskip("torch_geometric")

from gnn.models import GraphNetworkBuilder


def _nodes():
    return [
        {'id': 'A', 'lat': 10.0, 'lng': 20.0},
        {'id': 'B', 'lat': 10.1, 'lng': 20.1},
    ]


def _edge(source='A', target='B'):
    return {
        'source': source,
        'target': target,
        'distance': 10.0,
        'time': 5.0,
        'cost': 20.0,
        'fuel': 2.0,
        'congestion': 0.1,
    }


def test_build_road_network_rejects_unknown_source_node():
    builder = GraphNetworkBuilder()

    with pytest.raises(ValueError, match="Unknown edge endpoint"):
        builder.build_road_network(_nodes(), [_edge(source='UNKNOWN')])

    assert 'UNKNOWN' not in builder.graph


def test_build_road_network_rejects_unknown_target_node():
    builder = GraphNetworkBuilder()

    with pytest.raises(ValueError, match="Unknown edge endpoint"):
        builder.build_road_network(_nodes(), [_edge(target='UNKNOWN')])

    assert 'UNKNOWN' not in builder.graph


def test_build_road_network_validates_all_edges_before_mutating_graph():
    builder = GraphNetworkBuilder()
    edges = [_edge(), _edge(source='B', target='PHANTOM')]

    with pytest.raises(ValueError, match="Unknown edge endpoint"):
        builder.build_road_network(_nodes(), edges)

    assert set(builder.graph.nodes) == set()
    assert list(builder.graph.edges) == []


def test_build_road_network_accepts_edges_with_declared_endpoints():
    builder = GraphNetworkBuilder()

    graph = builder.build_road_network(_nodes(), [_edge()])

    assert set(graph.nodes) == {'A', 'B'}
    assert list(graph.edges) == [('A', 'B')]
