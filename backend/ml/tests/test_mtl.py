import pytest
import torch
from mtl.model import MultiTaskModel

class TestMTLModel:
    def test_mtl_init(self):
        model = MultiTaskModel(input_dim=12)
        assert model is not None
        assert hasattr(model, 'forward')
