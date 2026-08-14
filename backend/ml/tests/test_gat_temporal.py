import pytest

torch = pytest.importorskip("torch")
pytest.importorskip("torch_geometric")

from gat.model import SpatialTemporalGAT


def _edge_index():
    return torch.tensor([[0, 1], [1, 0]], dtype=torch.long)


def test_forward_output_shape():
    model = SpatialTemporalGAT(in_features=2, prediction_horizon=3)
    x = torch.zeros(2, 5, 4, 2)
    out = model(x, _edge_index())
    assert out.shape == (2, 5, 3)


def test_feature_dimension_guard():
    model = SpatialTemporalGAT(in_features=4)
    x = torch.zeros(1, 2, 3, 1)
    with pytest.raises(ValueError):
        model(x, _edge_index())


def test_source_node_aggregated_at_every_timestep():
    model = SpatialTemporalGAT(
        in_features=1, hidden_features=4, out_features=2,
        num_layers=1, time_steps=3, prediction_horizon=1,
    )
    edge_index = _edge_index()

    def predict(source_value_ts1):
        x = torch.zeros(1, 2, 3, 1)
        x[0, 0, 1, 0] = source_value_ts1
        return model(x, edge_index)[0, 1, 0].item()

    low = predict(0.0)
    high = predict(5.0)
    assert abs(high - low) > 1e-3
