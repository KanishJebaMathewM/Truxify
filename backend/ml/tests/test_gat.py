import pytest

torch_geometric = pytest.importorskip("torch_geometric")
from gat.model import GATModel

class TestGATModel:
    def test_gat_init(self):
        model = GATModel(in_features=16, out_features=32)
        assert model is not None
        assert hasattr(model, 'forward')
