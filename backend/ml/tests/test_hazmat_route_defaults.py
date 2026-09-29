import pytest


torch_geometric = pytest.importorskip("torch_geometric")
from gnn.models import GraphNetworkBuilder, RouteOptimizer
from routes.gnn_routes import Edge


def test_missing_hazmat_permission_is_preserved_as_unknown():
    builder = GraphNetworkBuilder()
    builder.build_road_network(
        [
            {"id": "A", "lat": 12.0, "lng": 77.0},
            {"id": "B", "lat": 12.1, "lng": 77.1},
        ],
        [{
            "source": "A",
            "target": "B",
            "distance": 1.0,
            "time": 1.0,
            "cost": 1.0,
            "fuel": 1.0,
            "congestion": 0.0,
        }],
    )

    assert builder.graph["A"]["B"]["hazmat_allowed"] is None


def test_hazmat_route_rejects_unknown_road_permission():
    builder = GraphNetworkBuilder()
    builder.build_road_network(
        [
            {"id": "A", "lat": 12.0, "lng": 77.0},
            {"id": "B", "lat": 12.1, "lng": 77.1},
            {"id": "C", "lat": 12.2, "lng": 77.2},
        ],
        [
            {
                "source": "A", "target": "C", "distance": 1.0, "time": 1.0,
                "cost": 1.0, "fuel": 1.0, "congestion": 0.0,
            },
            {
                "source": "A", "target": "B", "distance": 2.0, "time": 2.0,
                "cost": 2.0, "fuel": 2.0, "congestion": 0.0,
                "hazmat_allowed": True,
            },
            {
                "source": "B", "target": "C", "distance": 2.0, "time": 2.0,
                "cost": 2.0, "fuel": 2.0, "congestion": 0.0,
                "hazmat_allowed": True,
            },
        ],
    )
    graph_data = builder.get_pytorch_data()
    optimizer = RouteOptimizer()

    route = optimizer._find_optimal_route(
        "A", "C", embeddings=None, graph_data=graph_data,
        objectives=["time"], constraints={"hazmat": True},
    )

    assert [(edge["from"], edge["to"]) for edge in route] == [("A", "B"), ("B", "C")]


def test_api_edge_defaults_hazmat_permission_to_unknown():
    field = Edge.model_fields["hazmat_allowed"]
    assert field.default is None
