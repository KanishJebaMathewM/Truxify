import pytest

torch_geometric = pytest.importorskip("torch_geometric")
from gnn.models import GNN_EDGE_FEATURE_DIM, GraphNetworkBuilder, RouteOptimizer


def test_zero_edge_graph_exports_valid_pyg_shapes():
    builder = GraphNetworkBuilder()
    builder.build_road_network(
        [
            {"id": "A", "lat": 10.0, "lng": 20.0},
            {"id": "B", "lat": 10.1, "lng": 20.1},
        ],
        [],
    )

    data = builder.get_pytorch_data()

    assert data.edge_index.shape == (2, 0)
    assert data.edge_attr.shape == (0, GNN_EDGE_FEATURE_DIM)


def test_zero_edge_graph_has_no_route_between_distinct_nodes():
    builder = GraphNetworkBuilder()
    builder.build_road_network(
        [
            {"id": "A", "lat": 10.0, "lng": 20.0},
            {"id": "B", "lat": 10.1, "lng": 20.1},
        ],
        [],
    )
    data = builder.get_pytorch_data()

    assert RouteOptimizer().optimize_route("A", "B", data) is None
