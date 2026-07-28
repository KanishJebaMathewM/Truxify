import pytest
import torch
from meta.model import MAMLModel

class TestMetaModel:
    def test_maml_init(self):
        model = MAMLModel(input_dim=10, output_dim=1)
        assert model is not None
        assert hasattr(model, 'adapt')
