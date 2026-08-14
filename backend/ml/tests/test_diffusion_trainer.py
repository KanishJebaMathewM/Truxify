import pytest
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

from diffusion.trainer import DiffusionTrainer


class DummyDiffusion(nn.Module):
    """Minimal stand-in for a conditional diffusion model."""
    def __init__(self, x_dim: int = 4, c_dim: int = 4):
        super().__init__()
        self.num_timesteps = 10
        self.x_dim = x_dim
        self.c_dim = c_dim
        self.linear = nn.Linear(x_dim + c_dim, x_dim)

    def add_noise(self, x, t, noise):
        return x + noise

    def denoise(self, x, t):
        return self.linear(x)


class TestDiffusionValidateCondition:
    def test_validate_raises_when_condition_required_but_missing(self):
        trainer = DiffusionTrainer(model=DummyDiffusion(), batch_size=2)
        val = torch.randn(6, 4)
        loader = DataLoader(TensorDataset(val), batch_size=2)

        with pytest.raises(ValueError):
            trainer.validate(loader, condition_loader=None, require_condition=True)

    def test_validate_threads_condition_into_model(self, monkeypatch):
        model = DummyDiffusion()
        trainer = DiffusionTrainer(model=model, batch_size=2)

        val = torch.randn(6, 4)
        cond = torch.randn(6, 4)

        seen = {}
        orig_denoise = model.denoise

        def spy(x, t):
            seen["last_x_dim"] = x.shape[-1]
            return orig_denoise(x, t)

        monkeypatch.setattr(model, "denoise", spy)

        loader = DataLoader(TensorDataset(val), batch_size=2)
        cond_loader = DataLoader(TensorDataset(cond), batch_size=2)

        loss = trainer.validate(loader, condition_loader=cond_loader)

        assert isinstance(loss, float)
        # The condition must have been concatenated into the model input.
        assert seen["last_x_dim"] == model.x_dim + model.c_dim
