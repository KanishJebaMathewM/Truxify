import pytest
import torch
from pinns.model import PhysicsInformedNN

class TestPINNModel:
    def test_pinn_init(self):
        model = PhysicsInformedNN(input_dim=2, hidden_dim=32, output_dim=1)
        assert model is not None
        assert hasattr(model, 'forward')
