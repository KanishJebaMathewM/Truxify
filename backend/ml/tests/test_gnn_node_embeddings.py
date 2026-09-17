import pytest
import torch

pytest.importorskip("torch_geometric")

from gnn.models import GNNRouteModel


def test_node_embeddings_and_graph_predictions_have_explicit_shapes():
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
