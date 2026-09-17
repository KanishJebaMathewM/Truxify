import math

import pytest


torch_geometric = pytest.importorskip("torch_geometric")
from gnn.models import GraphNetworkBuilder
from routes.gnn_routes import Node


def valid_node():
    return {
        "id": "A",
        "lat": 12.97,
        "lng": 77.59,
        "traffic": 20,
        "road_type": "local",
        "speed_limit": 50,
    }


def test_node_schema_accepts_boundary_values():
    node = Node(
        id="A",
        lat=-90,
        lng=180,
        traffic=100,
        speed_limit=0,
    )

    assert node.lat == -90
    assert node.lng == 180
    assert node.traffic == 100
    assert node.speed_limit == 0


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("lat", -90.0001),
        ("lat", 90.0001),
        ("lng", -180.0001),
        ("lng", 180.0001),
        ("traffic", -0.0001),
        ("traffic", 100.0001),
        ("speed_limit", -0.0001),
        ("lat", math.nan),
        ("lat", math.inf),
        ("lng", -math.inf),
        ("traffic", math.nan),
        ("speed_limit", math.inf),
    ],
)
def test_node_schema_rejects_invalid_numeric_values(field, value):
    payload = valid_node()
    payload[field] = value

    with pytest.raises(ValueError):
        Node(**payload)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("lat", -91),
        ("lat", 91),
        ("lng", -181),
        ("lng", 181),
        ("traffic", -1),
        ("traffic", 101),
        ("speed_limit", -1),
    ],
)
def test_graph_builder_rejects_invalid_node_features(field, value):
    node = valid_node()
    node[field] = value

    builder = GraphNetworkBuilder()
    with pytest.raises(ValueError):
        builder.build_road_network([node], [])


def test_graph_builder_rejects_non_finite_node_features():
    for field, value in (
        ("lat", math.nan),
        ("lng", math.inf),
        ("traffic", -math.inf),
        ("speed_limit", math.nan),
    ):
        node = valid_node()
        node[field] = value

        builder = GraphNetworkBuilder()
        with pytest.raises(ValueError):
            builder.build_road_network([node], [])
