import pytest
import torch

torch_geometric = pytest.importorskip("torch_geometric")
from gnn.models import GNNRouteModel, RouteOptimizer


def test_gnn_model_does_not_register_unused_multihead_attention():
    model = GNNRouteModel(input_dim=9, hidden_dim=16, output_dim=8, edge_dim=5)

    assert not hasattr(model, "attention")
    assert "attention" not in dict(model.named_children())


def test_legacy_checkpoint_with_attention_weights_still_loads(tmp_path):
    model = GNNRouteModel()
    legacy_attention = torch.nn.MultiheadAttention(model.hidden_dim, num_heads=8)
    state_dict = model.state_dict()

    for key, value in legacy_attention.state_dict().items():
        state_dict[f"attention.{key}"] = value

    checkpoint = tmp_path / "legacy_gnn_route.pth"
    torch.save(state_dict, checkpoint)

    optimizer = RouteOptimizer(model_path=str(checkpoint))

    assert optimizer.model is not None
    assert not hasattr(optimizer.model, "attention")
