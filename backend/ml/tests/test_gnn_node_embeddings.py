import pytest
import torch

pytest.importorskip("torch_geometric")

from torch_geometric.data import Data

from gnn.models import GNNRouteModel, GraphNetworkBuilder, RouteOptimizer


def test_node_embeddings_and_graph_predictions_have_explicit_shapes():
    """Verify node embeddings and batched graph outputs keep explicit shapes."""
    model = GNNRouteModel(input_dim=9, hidden_dim=16, output_dim=8, edge_dim=5)
    model.eval()

    x = torch.randn(4, 9)
    edge_index = torch.tensor(
        [[0, 1, 2, 3], [1, 2, 3, 0]], dtype=torch.long
    )
    edge_attr = torch.randn(4, 5)
    batch = torch.tensor([0, 0, 1, 1], dtype=torch.long)

    node_embeddings = model.encode_node_embeddings(x, edge_index, edge_attr)
    graph_predictions = model(x, edge_index, edge_attr, batch)
    serving_output = model(x, edge_index, edge_attr)

    assert node_embeddings.shape == (4, 16)
    assert graph_predictions.shape == (2,)
    assert serving_output.shape == (4, 16)
    assert torch.equal(node_embeddings, serving_output)


def test_route_inference_uses_per_node_embeddings():
    """Verify route inference receives the per-node representation."""
    builder = GraphNetworkBuilder()
    builder.build_road_network(
        [
            {"id": "A", "lat": 12.97, "lng": 77.59},
            {"id": "B", "lat": 12.98, "lng": 77.60},
            {"id": "C", "lat": 12.99, "lng": 77.61},
        ],
        [
            {"source": "A", "target": "B", "distance": 1.0, "time": 1.0},
            {"source": "B", "target": "C", "distance": 1.0, "time": 1.0},
        ],
    )
    graph_data = builder.get_pytorch_data()
    optimizer = RouteOptimizer(allow_untrained=True)

    captured = []

    def capture_embeddings(start, end, embeddings, graph_data, objectives, constraints):
        """Capture the embeddings passed into the route-search implementation."""
        captured.append(torch.as_tensor(embeddings))
        return [
            {
                "from": "A",
                "to": "B",
                "distance": 1.0,
                "time": 1.0,
                "cost": 0.0,
                "fuel": 0.0,
                "congestion": 0.0,
            }
        ]

    optimizer._find_optimal_route = capture_embeddings
    result = optimizer.optimize_route("A", "B", graph_data, objectives=["time"])

    assert result["success"] is True
    assert len(captured) == 1
    assert captured[0].shape == (3, optimizer.model.hidden_dim)


def test_single_graph_training_uses_the_graph_prediction_head():
    """Verify single-graph training uses the graph prediction head."""
    optimizer = RouteOptimizer(allow_untrained=False)
    data = Data(
        x=torch.randn(4, 9),
        edge_index=torch.tensor(
            [[0, 1, 2, 3], [1, 2, 3, 0]], dtype=torch.long
        ),
        edge_attr=torch.randn(4, 5),
        y=torch.tensor([1.0]),
    )

    loss = optimizer.train([data], epochs=1)

    assert isinstance(loss, float)
    assert optimizer.is_trained is True
