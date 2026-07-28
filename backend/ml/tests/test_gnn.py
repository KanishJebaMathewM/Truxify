import pytest

torch_geometric = pytest.importorskip("torch_geometric")
from gnn.models import RouteGNN

class TestGNNModel:
    def test_route_gnn_init(self):
        model = RouteGNN(in_channels=10, hidden_channels=32, out_channels=2)
        assert model is not None
        assert hasattr(model, 'forward')
