from threading import RLock
from .training_transition import (
    integer, observations, owned, policy, initialize_condition, transition, finite_tree,
    batches as owned_batches,
)

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset, SequentialSampler
import numpy as np
from typing import Dict, List, Optional, Tuple
import logging
from tqdm import tqdm
from datetime import datetime

logger = logging.getLogger(__name__)

class DiffusionTrainer:
    """Trainer for diffusion models"""
    
    def __init__(
        self,
        model: nn.Module,
        device: str = "cuda" if torch.cuda.is_available() else "cpu",
        lr: float = 1e-4,
        batch_size: int = 32
    ):
        self._operation_lock = RLock()
        self.model = model.to(device)
        self.device = device
        self.batch_size = batch_size
        
        # Optimizer
        self.optimizer = optim.AdamW(model.parameters(), lr=lr)
        
        # Metrics
        self.train_losses = []
        self.val_losses = []
        
        logger.info(f"✅ Trainer initialized on {device}")
    
    @owned
    def train_step(self, x: torch.Tensor, condition: Optional[torch.Tensor] = None) -> float:
        """Own observations and verify an actual native denoising AdamW candidate."""
        x, condition = observations(self.model, x, condition)
        policy(self.optimizer)
        finite_tree(self.model.state_dict())
        initialize_condition(self.model, condition)
        with transition(self.model, self.optimizer):
            self.model.train()
            self.optimizer.zero_grad(set_to_none=True)
            t = torch.randint(0, self.model.num_timesteps, (x.shape[0],), device=self.device)
            noise = torch.randn_like(x)
            x_noisy = self.model.add_noise(x, t, noise)
            if condition is not None:
                x_noisy = torch.cat([x_noisy, condition], dim=-1)
            predicted_noise = self.model.denoise(x_noisy, t)
            if predicted_noise.shape != noise.shape or not torch.isfinite(predicted_noise).all():
                raise ValueError("native noise predictions must have finite matching dimensions")
            loss = nn.functional.mse_loss(predicted_noise, noise)
            if not torch.isfinite(loss):
                raise ValueError("native denoising objective is nonfinite")
            loss.backward()
            torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0, error_if_nonfinite=True)
            if any(p.grad is not None and not torch.isfinite(p.grad).all() for p in self.model.parameters()):
                raise ValueError("native denoising gradients are nonfinite")
            self.optimizer.step()
        return float(loss.detach())

    @staticmethod
    def _dataset(data, condition=None):
        if not isinstance(data, torch.Tensor) or data.ndim < 2 or len(data) == 0:
            raise ValueError("data must be a nonempty batched tensor")
        if condition is None:
            return TensorDataset(data)
        if not isinstance(condition, torch.Tensor) or condition.ndim < 2:
            raise ValueError("condition must be a batched tensor")
        if len(condition) != len(data):
            raise ValueError("data and condition rows must match")
        # Global context is shared across a sample's sequence positions.
        if condition.ndim == 2 and data.ndim == 3:
            condition = condition.unsqueeze(1).expand(-1, data.shape[1], -1)
        if condition.shape[:-1] != data.shape[:-1]:
            raise ValueError("data and condition batch/sequence shapes must match")
        return TensorDataset(data, condition)

    @staticmethod
    def _unpack(batch):
        if isinstance(batch, torch.Tensor):
            return batch, None
        if isinstance(batch, (tuple, list)) and len(batch) in (1, 2):
            if all(isinstance(value, torch.Tensor) for value in batch):
                return batch[0], batch[1] if len(batch) == 2 else None
        raise ValueError("expected a tensor or one/two tensor dataset batch")

    def _batches(self, dataloader, condition_loader=None):
        if len(dataloader) == 0:
            raise ValueError("loader must contain at least one batch")
        if condition_loader is not None:
            # Independent random permutations cannot establish row ownership.
            if not all(isinstance(loader.sampler, SequentialSampler)
                       for loader in (dataloader, condition_loader)):
                raise ValueError("separate condition loaders must be sequential; use a joint dataset")
            if (len(dataloader.dataset) != len(condition_loader.dataset)
                    or dataloader.batch_size != condition_loader.batch_size
                    or dataloader.drop_last != condition_loader.drop_last
                    or len(dataloader) != len(condition_loader)):
                raise ValueError("separate loaders must have identical row/batch boundaries")
            condition_iter = iter(condition_loader)
        else:
            condition_iter = None
        for batch in dataloader:
            data, condition = self._unpack(batch)
            if condition_iter is not None:
                if condition is not None:
                    raise ValueError("conditions supplied twice")
                condition, extra = self._unpack(next(condition_iter))
                if extra is not None:
                    raise ValueError("condition loader must contain one tensor")
            # The same shape contract applies to both legacy and joint batches.
            dataset = self._dataset(data, condition)
            yield dataset.tensors[0], dataset.tensors[1] if condition is not None else None

    @owned
    def train_epoch(self, dataloader: DataLoader,
                    condition_loader: Optional[DataLoader] = None) -> float:
        """Train jointly owned examples; never cycle unrelated context."""
        total_loss = 0.0
        total_rows = 0
        batches = owned_batches(self.model, self._batches(dataloader, condition_loader))
        for data, condition in batches:
            loss = self.train_step(data, condition)
            total_loss += loss * len(data)
            total_rows += len(data)
        return total_loss / total_rows

    @owned
    def train(self, train_data: torch.Tensor, epochs: int = 100,
              val_data: Optional[torch.Tensor] = None,
              condition_data: Optional[torch.Tensor] = None,
              val_condition_data: Optional[torch.Tensor] = None) -> Dict:
        """Shuffle each sample with its own context, including held-out data."""
        epochs = integer(epochs, "epochs", 512)
        integer(self.batch_size, "batch_size", 64)
        train_data, condition_data = observations(self.model, train_data, condition_data, epochs)
        if val_data is not None:
            val_data, val_condition_data = observations(self.model, val_data, val_condition_data, epochs)
        if (condition_data is not None and val_condition_data is not None
                and condition_data.shape[-1] != val_condition_data.shape[-1]):
            raise ValueError("train and held-out condition widths must share one projection")
        train_dataset = self._dataset(train_data, condition_data)
        if val_data is None and val_condition_data is not None:
            raise ValueError("validation conditions require validation data")
        if val_data is not None and ((condition_data is None) != (val_condition_data is None)):
            raise ValueError("conditional validation requires its own row conditions")
        # Validate both complete streams before the first optimizer update.
        val_dataset = self._dataset(val_data, val_condition_data) if val_data is not None else None
        train_loader = DataLoader(train_dataset, batch_size=self.batch_size, shuffle=True)
        val_loader = (DataLoader(val_dataset, batch_size=self.batch_size, shuffle=False)
                      if val_dataset is not None else None)
        for epoch in range(epochs):
            train_loss = self.train_epoch(train_loader)
            val_loss = None
            if val_loader is not None:
                val_loss = self.validate(val_loader, require_condition=condition_data is not None)
            self.train_losses.append(train_loss)
            if val_loss is not None:
                self.val_losses.append(val_loss)
            if (epoch + 1) % 10 == 0:
                logger.info("Epoch %s/%s - Train Loss: %.4f", epoch + 1, epochs, train_loss)
        return {
            'train_losses': self.train_losses,
            'val_losses': self.val_losses,
            'final_train_loss': self.train_losses[-1],
            'final_val_loss': self.val_losses[-1] if val_loader is not None else None
        }

    @owned
    def validate(self, dataloader: DataLoader,
                 condition_loader: Optional[DataLoader] = None,
                 require_condition: bool = False) -> float:
        """Measure the held-out paired objective without training-row recycling."""
        total_loss = 0.0
        total_rows = 0
        batches = owned_batches(self.model, self._batches(dataloader, condition_loader))
        if require_condition and any(condition is None for _, condition in batches):
            raise ValueError("condition_loader or joint conditions required for validation")
        prior_modes = [(module, module.training) for module in self.model.modules()]
        self.model.eval()
        try:
            with torch.no_grad():
                for data, condition in batches:
                    if require_condition and condition is None:
                        raise ValueError("condition_loader or joint conditions required for validation")
                    data = data.to(self.device)
                    t = torch.randint(0, self.model.num_timesteps, (len(data),), device=self.device)
                    noise = torch.randn_like(data)
                    x_noisy = self.model.add_noise(data, t, noise)
                    if condition is not None:
                        x_noisy = torch.cat([x_noisy, condition.to(self.device)], dim=-1)
                    predicted_noise = self.model.denoise(x_noisy, t)
                    if predicted_noise.shape != noise.shape or not torch.isfinite(predicted_noise).all():
                        raise ValueError("validation predictions must be finite with matching dimensions")
                    loss = nn.MSELoss()(predicted_noise, noise)
                    if not torch.isfinite(loss):
                        raise ValueError("validation objective is nonfinite")
                    total_loss += loss.item() * len(data)
                    total_rows += len(data)
        finally:
            for module, mode in prior_modes:
                module.training = mode
        return total_loss / total_rows

    def generate_routes(self, num_routes: int = 10, route_length: int = 50) -> torch.Tensor:
        """Generate routes using trained model"""
        self.model.eval()
        with torch.no_grad():
            routes = self.model.sample(num_routes, route_length)
        return routes
    
    def save_checkpoint(self, path: str = "models/diffusion_checkpoint.pth"):
        """Save training checkpoint"""
        torch.save({
            'model_state_dict': self.model.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict(),
            'train_losses': self.train_losses,
            'val_losses': self.val_losses,
            'timestamp': datetime.now().isoformat()
        }, path)
        logger.info(f"✅ Checkpoint saved to {path}")
    
    def load_checkpoint(self, path: str = "models/diffusion_checkpoint.pth"):
        """Load training checkpoint"""
        checkpoint = torch.load(path, map_location=self.device)
        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
        self.train_losses = checkpoint['train_losses']
        self.val_losses = checkpoint['val_losses']
        logger.info(f"✅ Checkpoint loaded from {path}")