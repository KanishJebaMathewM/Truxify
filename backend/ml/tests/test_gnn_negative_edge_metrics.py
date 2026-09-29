import numpy as np
import pytest

torch_geometric = pytest.importorskip("torch_geometric")
from gnn.models import GraphNetworkBuilder, RouteOptimizer


EDGE_METRICS = ["distance", "time", "cost", "fuel", "congestion"]


@pytest.fixture
def sample_nodes():
    return [
        {
            "id": "A",
            "lat": 12.97,
            "lng": 77.59,
            "traffic": 20,
            "road_type": "highway",
            "speed_limit": 80,
        },
        {
            "id": "B",
            "lat": 12.98,
            "lng": 77.60,
            "traffic": 30,
            "road_type": "arterial",
            "speed_limit": 60,
        },
    ]


@pytest.fixture
def valid_edge():
    return {
        "source": "A",
        "target": "B",
        "distance": 10.0,
        "time": 15.0,
        "cost": 100.0,
        "fuel": 5.0,
        "congestion": 0.2,
    }


@pytest.mark.parametrize("metric", EDGE_METRICS)
def test_negative_edge_metric_is_rejected_before_graph_mutation(
    sample_nodes, valid_edge, metric
):
    """Reject negative routing metrics before changing the graph."""
    builder = GraphNetworkBuilder()
    valid_edge[metric] = -1.0

    with pytest.raises(
        ValueError,
        match=rf"Negative edge metric '{metric}' is not allowed",
    ):
        builder.build_road_network(sample_nodes, [valid_edge])

    assert builder.graph.number_of_nodes() == 0
    assert builder.graph.number_of_edges() == 0


def test_zero_edge_metrics_remain_valid(sample_nodes, valid_edge):
    """Allow zero-valued metrics while rejecting only invalid negatives."""
    builder = GraphNetworkBuilder()
    for metric in EDGE_METRICS:
        valid_edge[metric] = 0.0

    builder.build_road_network(sample_nodes, [valid_edge])

    assert builder.graph.number_of_nodes() == 2
    assert builder.graph.number_of_edges() == 1


def test_negative_edge_score_is_not_masked_by_clamp(sample_nodes, valid_edge):
    """Reject an invalid negative score instead of clamping it to a tiny weight."""
    builder = GraphNetworkBuilder()
    builder.build_road_network(sample_nodes, [valid_edge])
    graph_data = builder.get_pytorch_data()
    graph_data.graph["A"]["B"]["time"] = -1.0

    optimizer = RouteOptimizer()
    embeddings = np.zeros((2, 1), dtype=float)

    with pytest.raises(ValueError, match="Negative route edge score is not allowed"):
        optimizer._calculate_score(
            embeddings,
            "A",
            "B",
            ["time"],
            graph_data,
            graph_data.node_map,
        )
