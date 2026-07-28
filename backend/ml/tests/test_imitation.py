import pytest
import torch
from imitation.model import BehavioralCloning

class TestImitationModel:
    def test_behavioral_cloning_init(self):
        model = BehavioralCloning(state_dim=20, action_dim=4)
        assert model is not None
        assert hasattr(model, 'forward')
