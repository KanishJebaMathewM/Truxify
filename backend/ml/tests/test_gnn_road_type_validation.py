# Regression coverage for road-type validation.
import pytest
from pydantic import ValidationError

torch_geometric = pytest.importorskip("torch_geometric")
from gnn.models import GNN_ROAD_TYPES, GraphNetworkBuilder
from routes.gnn_routes import Node


@pytest.mark.parametrize("road_type", GNN_ROAD_TYPES)
def test_supported_road_types_produce_one_hot_encoding(road_type):
    builder = GraphNetworkBuilder()
    encoding = builder._road_type_encoding(road_type)
    assert len(encoding) == len(GNN_ROAD_TYPES)
    assert sum(encoding) == 1
    assert encoding[GNN_ROAD_TYPES.index(road_type)] == 1


def test_unknown_road_type_is_rejected_during_graph_construction():
    builder = GraphNetworkBuilder()
    with pytest.raises(ValueError, match="Unsupported road type 'expressway'"):
        builder.build_road_network(
            [{"id": "A", "lat": 10.0, "lng": 20.0, "road_type": "expressway"}],
            [],
        )
    assert list(builder.graph.nodes) == []


def test_unknown_road_type_cannot_be_encoded_as_all_zero_vector():
    builder = GraphNetworkBuilder()
    with pytest.raises(ValueError, match="Unsupported road type 'expressway'"):
        builder._road_type_encoding("expressway")


def test_api_node_schema_rejects_unknown_road_type():
    with pytest.raises(ValidationError):
        Node(id="A", lat=10.0, lng=20.0, road_type="expressway")


def test_api_node_schema_uses_local_as_default_road_type():
    node = Node(id="A", lat=10.0, lng=20.0)
    assert node.road_type == "local"
