"""Unit tests for backend/ml/diffusion/trainer.py.

Run with: python3 -m pytest tests/test_diffusion_trainer.py -v --no-header
"""
import torch
import torch.nn as nn

from diffusion.trainer import DiffusionTrainer


class StubDiffusionModel(nn.Module):
    """Minimal diffusion model with the surface the trainer uses."""

    def __init__(self, num_timesteps=10, in_dim=4):
        super().__init__()
        self.num_timesteps = num_timesteps
        self.net = nn.Linear(in_dim, in_dim)

    def add_noise(self, x, t, noise):
        return x + noise

    def denoise(self, x_noisy, t):
        return self.net(x_noisy)


def make_trainer():
    model = StubDiffusionModel(num_timesteps=10, in_dim=4)
    return DiffusionTrainer(model, device="cpu", lr=1e-3, batch_size=8), model


class TestDiffusionTrainer:
    """Tests for the diffusion-model trainer."""

    def test_train_step_returns_scalar_loss(self):
        """A single training step must return a finite float loss."""
        trainer, _ = make_trainer()
        x = torch.randn(8, 4)
        loss = trainer.train_step(x)
        assert isinstance(loss, float)
        assert loss > 0.0

    def test_train_step_updates_weights(self):
        """After a train step the model weights must change."""
        trainer, model = make_trainer()
        before = model.net.weight.detach().clone()
        x = torch.randn(8, 4)
        trainer.train_step(x)
        after = model.net.weight.detach()
        assert not torch.allclose(before, after)

    def test_train_epoch_returns_mean_loss(self):
        """train_epoch must return the mean batch loss when batches are tensors."""
        trainer, _ = make_trainer()
        dataset = torch.randn(16, 4)

        class TensorBatchLoader:
            def __iter__(self):
                for i in range(0, 16, 8):
                    yield dataset[i : i + 8]

        loss = trainer.train_epoch(TensorBatchLoader())
        assert isinstance(loss, float)
        assert loss > 0.0

    def test_train_records_losses(self):
        """train must populate the loss history and return the summary dict."""
        trainer, _ = make_trainer()
        train_data = torch.randn(16, 4)

        class TensorBatchLoader:
            def __iter__(self):
                for i in range(0, 16, 8):
                    yield train_data[i : i + 8]

        # Drive the training loop with tensor batches via a monkeypatched epoch.
        trainer.train_epoch = lambda loader, condition_loader=None: 1.5
        result = trainer.train(train_data, epochs=2)
        assert set(result.keys()) == {
            "train_losses", "val_losses", "final_train_loss", "final_val_loss",
        }
        assert len(result["train_losses"]) == 2
        assert result["final_train_loss"] == 1.5
