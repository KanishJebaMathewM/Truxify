import pytest

from gnn.models import GraphNetworkBuilder


def node(node_id, lat=12.97, lng=77.59, traffic=20):
    return {
        'id': node_id,
        'lat': lat,
        'lng': lng,
        'traffic': traffic,
        'road_type': 'highway',
        'speed_limit': 80,
    }


def test_duplicate_node_ids_are_rejected_before_graph_mutation():
    """Reject duplicate node IDs without adding any of the supplied nodes."""
    builder = GraphNetworkBuilder()
    nodes = [
        node('A', lat=12.97),
        node('B', lat=12.98),
        node('A', lat=99.99, traffic=95),
    ]

    with pytest.raises(ValueError, match=r"Duplicate node ID\(s\): A"):
        builder.build_road_network(nodes, [])

    assert builder.graph.number_of_nodes() == 0


def test_duplicate_node_ids_cannot_overwrite_existing_features():
    """Reject duplicate input before overwriting an already-built node."""
    builder = GraphNetworkBuilder()
    builder.build_road_network([node('A', lat=12.97, traffic=20)], [])

    duplicate_nodes = [
        node('A', lat=12.98, traffic=80),
        node('A', lat=13.99, traffic=95),
    ]

    with pytest.raises(ValueError, match=r"Duplicate node ID\(s\): A"):
        builder.build_road_network(duplicate_nodes, [])

    assert builder.graph.nodes['A']['lat'] == 12.97
    assert builder.graph.nodes['A']['traffic'] == 20


def test_all_duplicate_node_ids_are_reported():
    """Report each duplicated identifier instead of silently accepting later entries."""
    builder = GraphNetworkBuilder()
    nodes = [
        node('A'),
        node('B'),
        node('A', lat=13.0),
        node('C'),
        node('B', lat=14.0),
        node('B', lat=15.0),
    ]

    with pytest.raises(ValueError, match=r"Duplicate node ID\(s\): A, B"):
        builder.build_road_network(nodes, [])

    assert builder.graph.number_of_nodes() == 0


def test_unique_node_ids_are_accepted():
    """Accept a normal node set and preserve each node's declared features."""
    builder = GraphNetworkBuilder()
    builder.build_road_network(
        [
            node('A', lat=12.97, traffic=20),
            node('B', lat=12.98, traffic=30),
        ],
        [],
    )

    assert builder.graph.number_of_nodes() == 2
    assert builder.graph.nodes['A']['lat'] == 12.97
    assert builder.graph.nodes['B']['traffic'] == 30
