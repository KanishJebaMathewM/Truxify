import logging
import threading
from threading import RLock
from typing import Dict

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from pinns.training_transition import (
    PINNInputError,
    checked_transition,
    loop_policy,
    owned_operation,
)
from torch.autograd import grad

from .checkpoint_state import capture_state, restore_state

logger = logging.getLogger(__name__)

class PhysicsInformedNN(nn.Module):
    """Physics-Informed Neural Network"""
    
    def __init__(
        self,
        input_dim: int = 2,
        hidden_dim: int = 256,
        output_dim: int = 1,
        num_layers: int = 6,
        activation: str = 'tanh'
    ):
        super().__init__()
        
        self.input_dim = input_dim
        self.hidden_dim = hidden_dim
        self.output_dim = output_dim
        self.num_layers = num_layers
        
        # Activation function
        if activation == 'tanh':
            self.activation = torch.tanh
        elif activation == 'relu':
            self.activation = F.relu
        elif activation == 'silu':
            self.activation = F.silu
        else:
            self.activation = torch.tanh
        
        # Input layer
        self.input_layer = nn.Linear(input_dim, hidden_dim)
        
        # Hidden layers
        self.hidden_layers = nn.ModuleList([
            nn.Linear(hidden_dim, hidden_dim) for _ in range(num_layers - 1)
        ])
        
        # Output layer
        self.output_layer = nn.Linear(hidden_dim, output_dim)
        
        # Initialize weights
        self._initialize_weights()
        
        logger.info(f"✅ PINN initialized with {num_layers} layers, {hidden_dim} neurons")
    
    def _initialize_weights(self):
        """Initialize weights using Xavier initialization"""
        for layer in self.modules():
            if isinstance(layer, nn.Linear):
                nn.init.xavier_uniform_(layer.weight)
                nn.init.zeros_(layer.bias)
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Forward pass"""
        # Input layer
        x = self.input_layer(x)
        x = self.activation(x)
        
        # Hidden layers
        for layer in self.hidden_layers:
            x = layer(x)
            x = self.activation(x)
        
        # Output layer
        x = self.output_layer(x)
        return x

class PhysicsLoss:
    """Physics-informed loss functions"""
    
    def __init__(self, physics_type: str = 'diffusion'):
        self.physics_type = physics_type
        
        logger.info(f"✅ Physics loss initialized with {physics_type}")
    
    @staticmethod
    def _gradient(u: torch.Tensor, x: torch.Tensor) -> torch.Tensor:
        """Scalar rowwise field derivatives, including disconnected constants."""
        if x.ndim != 2 or not len(x) or u.shape != (len(x), 1):
            raise ValueError("physics requires nonempty coordinates and one scalar field per row")
        if not x.requires_grad:
            raise ValueError("physics coordinates must require gradients")
        if not u.requires_grad:
            return x * 0
        derivative = grad(u, x, grad_outputs=torch.ones_like(u),
                          create_graph=True, allow_unused=True)[0]
        # Keep a zero-valued graph to permit higher derivatives and parameter
        # backpropagation for constant or affine fields.
        zero = x * 0 + u * 0
        return zero if derivative is None else derivative + zero

    def _space_time(self, u: torch.Tensor, x: torch.Tensor):
        if x.ndim != 2 or x.shape[1] != 2:
            raise ValueError("evolution equations require [space, time] coordinates")
        first = self._gradient(u, x)
        return first[:, 0:1], first[:, 1:2]

    def diffusion_loss(self, u: torch.Tensor, x: torch.Tensor, D: float = 1.0) -> torch.Tensor:
        """u_t - D*u_xx for coordinates [space, time]."""
        u_x, u_t = self._space_time(u, x)
        u_xx = self._gradient(u_x, x)[:, 0:1]
        return (u_t - D * u_xx).square().mean()

    def advection_loss(self, u: torch.Tensor, x: torch.Tensor, v: float = 1.0) -> torch.Tensor:
        """u_t + v*u_x for coordinates [space, time]."""
        u_x, u_t = self._space_time(u, x)
        return (u_t + v * u_x).square().mean()

    def burger_loss(self, u: torch.Tensor, x: torch.Tensor, nu: float = 0.01) -> torch.Tensor:
        """u_t + u*u_x - nu*u_xx for coordinates [space, time]."""
        u_x, u_t = self._space_time(u, x)
        u_xx = self._gradient(u_x, x)[:, 0:1]
        return (u_t + u * u_x - nu * u_xx).square().mean()

    def poisson_loss(self, u: torch.Tensor, x: torch.Tensor, f: torch.Tensor) -> torch.Tensor:
        """-sum_i u_xixi - f; every coordinate is spatial for Poisson."""
        first = self._gradient(u, x)
        if x.shape[1] == 0:
            raise ValueError("Poisson requires at least one spatial coordinate")
        laplacian = u * 0
        for axis in range(x.shape[1]):
            laplacian = laplacian + self._gradient(first[:, axis:axis+1], x)[:, axis:axis+1]
        forcing = torch.as_tensor(f, dtype=u.dtype, device=u.device)
        if forcing.ndim != 0 and forcing.shape != u.shape:
            raise ValueError("Poisson forcing must be scalar or one scalar per row")
        return (-laplacian - forcing).square().mean()

    def compute_loss(self, u: torch.Tensor, x: torch.Tensor, **kwargs) -> torch.Tensor:
        """Compute physics loss based on type"""
        if self.physics_type == 'diffusion':
            D = kwargs.get('D', 1.0)
            return self.diffusion_loss(u, x, D)
        elif self.physics_type == 'advection':
            v = kwargs.get('v', 1.0)
            return self.advection_loss(u, x, v)
        elif self.physics_type == 'burger':
            nu = kwargs.get('nu', 0.01)
            return self.burger_loss(u, x, nu)
        elif self.physics_type == 'poisson':
            f = kwargs.get('f', torch.zeros_like(u))
            return self.poisson_loss(u, x, f)
        else:
            raise ValueError(f"Unknown physics type: {self.physics_type}")

class PINNTrainer:
    """Trainer for Physics-Informed Neural Networks"""
    
    def __init__(
        self,
        model: PhysicsInformedNN,
        physics_loss: PhysicsLoss,
        lr: float = 1e-3,
        device: str = "cuda" if torch.cuda.is_available() else "cpu"
    ):
        self._operation_lock = threading.RLock()
        self.model = model.to(device)
        self.physics_loss = physics_loss
        self.device = device
        
        self.optimizer = torch.optim.Adam(model.parameters(), lr=lr)
        self.scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
            self.optimizer, patience=50, factor=0.5
        )
        
        # Loss weights
        self.data_weight = 1.0
        self.physics_weight = 1.0
        
        logger.info(f"✅ PINN Trainer initialized on {self.device}")
    
    def __getstate__(self):
        state = self.__dict__.copy()
        state.pop('_operation_lock', None)
        return state

    def __setstate__(self, state):
        self.__dict__.update(state)
        self._operation_lock = RLock()

    def _admit(self, x_data, y_data, x_phys, physics_kwargs):
        parameter = next(self.model.parameters())
        values = []
        for name, tensor in (("observations", x_data), ("targets", y_data),
                             ("collocation points", x_phys)):
            if not isinstance(tensor, torch.Tensor) or not tensor.is_floating_point() or tensor.layout != torch.strided:
                raise PINNInputError(f"{name} must be a finite floating tensor")
            if tensor.numel() > 1048576:
                raise PINNInputError("training tensor exceeds the owned value budget")
            tensor = tensor.to(device=parameter.device, dtype=parameter.dtype).clone()
            if not torch.isfinite(tensor).all():
                raise PINNInputError(f"{name} must be finite in model dtype")
            values.append(tensor)
        x_data, y_data, x_phys = values
        for points in (x_data, x_phys):
            if points.ndim != 2 or not 1 <= len(points) <= 10000 or points.shape[1] != self.model.input_dim:
                raise PINNInputError("points must be nonempty rows with input_dim coordinates")
        if self.model.output_dim != 1:
            raise PINNInputError("physics training requires one scalar model output")
        if y_data.ndim == 1:
            y_data = y_data[:, None]
        if y_data.shape != (len(x_data), 1):
            raise PINNInputError("targets must contain exactly one scalar per observation")
        kind = self.physics_loss.physics_type
        if kind not in ("poisson", "diffusion", "advection", "burger"):
            raise PINNInputError("unknown physics type")
        if kind != "poisson" and x_phys.shape[1] != 2:
            raise PINNInputError("evolution physics requires space/time coordinates")
        kwargs = dict(physics_kwargs)
        key = {"diffusion": "D", "advection": "v", "burger": "nu"}.get(kind)
        if key is not None and key in kwargs:
            coefficient = torch.as_tensor(kwargs[key], device=parameter.device, dtype=parameter.dtype).clone()
            if coefficient.ndim != 0 or not torch.isfinite(coefficient):
                raise PINNInputError("physics coefficient must be a finite scalar")
            kwargs[key] = coefficient
        if kind == "poisson" and "f" in kwargs:
            forcing = torch.as_tensor(kwargs["f"], device=parameter.device, dtype=parameter.dtype).clone()
            if forcing.shape == (len(x_phys),):
                forcing = forcing[:, None]
            if (forcing.ndim != 0 and forcing.shape != (len(x_phys), 1)) or not torch.isfinite(forcing).all():
                raise PINNInputError("forcing must be finite scalar or paired collocation rows")
            kwargs["f"] = forcing
        if not np.isfinite(self.data_weight) or not np.isfinite(self.physics_weight):
            raise PINNInputError("loss weights must be finite")
        if x_data.numel() + y_data.numel() + x_phys.numel() > 1048576:
            raise PINNInputError("complete observations exceed the owned value budget")
        return x_data, y_data, x_phys, kwargs

    @checked_transition
    def train_step(
        self,
        x_data: torch.Tensor,
        y_data: torch.Tensor,
        x_phys: torch.Tensor,
        **physics_kwargs
    ) -> Dict:
        """Single training step"""
        x_data, y_data, x_phys, physics_kwargs = self._admit(
            x_data, y_data, x_phys, physics_kwargs)
        if (len(x_data) + len(x_phys)) * sum(p.numel() for p in self.model.parameters()) > 200000000:
            raise PINNInputError("native PINN step exceeds admitted point/parameter work")
        self.model.train()
        self.optimizer.zero_grad()
        x_phys = x_phys.detach().clone().requires_grad_(True)
        
        # Data loss
        y_pred = self.model(x_data)
        data_loss = F.mse_loss(y_pred, y_data)
        
        # Physics loss
        u_phys = self.model(x_phys)
        phys_loss = self.physics_loss.compute_loss(u_phys, x_phys, **physics_kwargs)
        
        # Combined loss
        loss = self.data_weight * data_loss + self.physics_weight * phys_loss
        
        if not torch.isfinite(loss):
            raise ValueError("PINN objective must be finite")
        # Backward pass
        loss.backward()
        torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0, error_if_nonfinite=True)
        self.optimizer.step()
        
        return {
            'loss': loss.item(),
            'data_loss': data_loss.item(),
            'physics_loss': phys_loss.item(),
            'lr': self.optimizer.param_groups[0]['lr']
        }
    
    @owned_operation
    def train(
        self,
        x_data: torch.Tensor,
        y_data: torch.Tensor,
        x_phys: torch.Tensor,
        epochs: int = 1000,
        batch_size: int = 32,
        **physics_kwargs
    ) -> Dict:
        """Full training loop"""
        if any(isinstance(value, bool) or not isinstance(value, int) or value < 1
               for value in (epochs, batch_size)):
            raise PINNInputError("epochs and batch_size must be positive integers")
        # Validate the entire dataset before any batch can advance Adam.
        x_data, y_data, x_phys, physics_kwargs = self._admit(
            x_data, y_data, x_phys, physics_kwargs)
        loop_policy(self, len(x_data), len(x_phys), epochs, batch_size)
        losses, data_losses, phys_losses = [], [], []
        for epoch in range(epochs):
            indices = torch.randperm(len(x_data), device=x_data.device)
            epoch_loss = epoch_data_loss = epoch_phys_loss = 0.0
            for start in range(0, len(x_data), batch_size):
                data_indices = indices[start:start + batch_size]
                phys_indices = torch.randperm(len(x_phys), device=x_phys.device)[:batch_size]
                kwargs = dict(physics_kwargs)
                if "f" in kwargs and self.physics_loss.physics_type == "poisson" and kwargs["f"].ndim:
                    kwargs["f"] = kwargs["f"][phys_indices]
                result = self.train_step(x_data[data_indices], y_data[data_indices],
                                         x_phys[phys_indices], **kwargs)
                rows = len(data_indices)
                epoch_loss += result["loss"] * rows
                epoch_data_loss += result["data_loss"] * rows
                epoch_phys_loss += result["physics_loss"] * rows
            avg_loss = epoch_loss / len(x_data)
            losses.append(avg_loss)
            data_losses.append(epoch_data_loss / len(x_data))
            phys_losses.append(epoch_phys_loss / len(x_data))
            self.scheduler.step(avg_loss)
            if (epoch + 1) % 100 == 0:
                logger.info("PINN Epoch %s/%s: Loss=%.4f", epoch + 1, epochs, avg_loss)

        return {
            'losses': losses,
            'data_losses': data_losses,
            'physics_losses': phys_losses,
            'final_loss': losses[-1],
            'final_data_loss': data_losses[-1],
            'final_physics_loss': phys_losses[-1]
        }
    
    @owned_operation
    def predict(self, x: torch.Tensor) -> np.ndarray:
        """Make predictions"""
        self.model.eval()
        with torch.no_grad():
            x = x.to(self.device)
            predictions = self.model(x)
        return predictions.cpu().numpy()
    
    @owned_operation
    def save(self, path: str = "models/pinns_model.pth"):
        """Save model"""
        torch.save(capture_state(self), path)
        logger.info(f"✅ Model saved to {path}")
    
    @owned_operation
    def load(self, path: str = "models/pinns_model.pth"):
        """Load model"""
        checkpoint = torch.load(path, map_location=self.device)
        restore_state(self, checkpoint)
        logger.info(f"✅ Model loaded from {path}")
