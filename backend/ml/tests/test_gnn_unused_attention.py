import pytest
import torch

torch_geometric = pytest.importorskip("torch_geometric")
from gnn.models import GNNRouteModel, RouteOptimizer


def test_gnn_model_does_not_register_unused_multihead_attention():
    model = GNNRouteModel(input_dim=9, hidden_dim=16, output_dim=8, edge_dim=5)

    assert not hasattr(model, "attention")
    assert "attention" not in dict(model.named_children())


def test_checkpoint_with_legacy_attention_weights_still_loads(tmp_path):
    """Attention-prefixed weights from pre-#15808 checkpoints are dropped on load."""
    from torch_geometric.data import Data
    from gnn.models import GraphNetworkBuilder

    builder = GraphNetworkBuilder()
    builder.build_road_network(
        [
            {'id': 'A', 'lat': 12.97, 'lng': 77.59},
            {'id': 'B', 'lat': 12.98, 'lng': 77.60},
        ],
        [
            {'source': 'A', 'target': 'B', 'distance': 10.0, 'time': 15.0,
             'cost': 100.0, 'fuel': 5.0, 'congestion': 0.2},
        ],
    )
    graph_data = builder.get_pytorch_data()
    sample = Data(
        x=graph_data.x.clone(),
        edge_index=graph_data.edge_index.clone(),
        edge_attr=graph_data.edge_attr.clone(),
        y=torch.tensor([15.0], dtype=torch.float),
    )

    trainer = RouteOptimizer()
    trainer.train([sample], epochs=1)

    checkpoint = tmp_path / "legacy_gnn_route.pth"
    trainer.save_model(str(checkpoint))

    # Inject legacy attention weights into the persisted state dict.
    saved = torch.load(checkpoint)
    legacy_attention = torch.nn.MultiheadAttention(128, num_heads=8)
    for key, value in legacy_attention.state_dict().items():
        saved["state_dict"][f"attention.{key}"] = value
    torch.save(saved, checkpoint)

    optimizer = RouteOptimizer(model_path=str(checkpoint))

    assert optimizer.model is not None
    assert not hasattr(optimizer.model, "attention")
