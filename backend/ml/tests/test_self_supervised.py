import pytest
import torch
from self_supervised.model import SimCLR

class TestSelfSupervisedModel:
    def test_simclr_init(self):
        model = SimCLR(input_dim=128, hidden_dim=64, projection_dim=32)
        assert model is not None
        assert hasattr(model, 'forward')
