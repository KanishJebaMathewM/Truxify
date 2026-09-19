import pytest
import torch

torch_geometric = pytest.importorskip("torch_geometric")
from gnn.models import GNNRouteModel


def _sample_graph():
    x = torch.randn(3, 9)
    edge_index = torch.tensor([[0, 1, 2], [1, 2, 0]], dtype=torch.long)
    edge_attr = torch.randn(3, 5)
    return x, edge_index, edge_attr


def test_edge_dim_zero_is_rejected_at_initialization():
    with pytest.raises(ValueError, match="edge_dim must be a positive integer"):
        GNNRouteModel(edge_dim=0)


def test_negative_edge_dim_is_rejected_at_initialization():
    with pytest.raises(ValueError, match="edge_dim must be a positive integer"):
        GNNRouteModel(edge_dim=-1)


def test_none_edge_dim_disables_edge_attributes():
    model = GNNRouteModel(input_dim=9, hidden_dim=16, output_dim=8, edge_dim=None)
    model.eval()
    x, edge_index, _ = _sample_graph()

    output = model(x, edge_index)

    assert output is not None


def test_positive_edge_dim_consumes_edge_attributes():
    model = GNNRouteModel(input_dim=9, hidden_dim=16, output_dim=8, edge_dim=5)
    model.eval()
    x, edge_index, edge_attr = _sample_graph()

    output = model(x, edge_index, edge_attr=edge_attr)

    assert output is not None
