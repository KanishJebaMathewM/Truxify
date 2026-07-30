import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
from typing import Dict, List, Tuple, Optional, Callable
import logging
from torch.autograd import grad

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
    
    def diffusion_loss(self, u: torch.Tensor, x: torch.Tensor, D: float = 1.0) -> torch.Tensor:
        """Diffusion equation: ∂u/∂t = D * ∂²u/∂x²"""
        # First derivative with respect to x
        u_x = grad(u, x, grad_outputs=torch.ones_like(u), create_graph=True)[0]
        
        # Second derivative with respect to x
        u_xx = grad(u_x, x, grad_outputs=torch.ones_like(u_x), create_graph=True)[0]
        
        # Physics residual
        residual = u - D * u_xx
        loss = torch.mean(residual ** 2)
        
        return loss
    
    def advection_loss(self, u: torch.Tensor, x: torch.Tensor, v: float = 1.0) -> torch.Tensor:
        """Advection equation: ∂u/∂t + v * ∂u/∂x = 0"""
        # First derivative with respect to x
        u_x = grad(u, x, grad_outputs=torch.ones_like(u), create_graph=True)[0]
        
        # Physics residual
        residual = u + v * u_x
        loss = torch.mean(residual ** 2)
        
        return loss
    
    def burger_loss(self, u: torch.Tensor, x: torch.Tensor, nu: float = 0.01) -> torch.Tensor:
        """Burgers equation: ∂u/∂t + u * ∂u/∂x = nu * ∂²u/∂x²"""
        # First derivative with respect to x
        u_x = grad(u, x, grad_outputs=torch.ones_like(u), create_graph=True)[0]
        
        # Second derivative with respect to x
        u_xx = grad(u_x, x, grad_outputs=torch.ones_like(u_x), create_graph=True)[0]
        
        # Physics residual
        residual = u + u * u_x - nu * u_xx
        loss = torch.mean(residual ** 2)
        
        return loss
    
    def poisson_loss(self, u: torch.Tensor, x: torch.Tensor, f: torch.Tensor) -> torch.Tensor:
        """Poisson equation: -∇²u = f"""
        # Second derivative with respect to x
        u_x = grad(u, x, grad_outputs=torch.ones_like(u), create_graph=True)[0]
        u_xx = grad(u_x, x, grad_outputs=torch.ones_like(u_x), create_graph=True)[0]
        
        # Physics residual
        residual = -u_xx - f
        loss = torch.mean(residual ** 2)
        
        return loss
    
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
            f = kwargs.get('f', torch.zeros_like(x))
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
    
    def train_step(
        self,
        x_data: torch.Tensor,
        y_data: torch.Tensor,
        x_phys: torch.Tensor,
        **physics_kwargs
    ) -> Dict:
        """Single training step"""
        self.model.train()
        self.optimizer.zero_grad()
        
        # Move to device
        x_data = x_data.to(self.device)
        y_data = y_data.to(self.device)
        x_phys = x_phys.to(self.device)
        
        # Data loss
        y_pred = self.model(x_data)
        data_loss = F.mse_loss(y_pred, y_data)
        
        # Physics loss
        u_phys = self.model(x_phys)
        phys_loss = self.physics_loss.compute_loss(u_phys, x_phys, **physics_kwargs)
        
        # Combined loss
        loss = self.data_weight * data_loss + self.physics_weight * phys_loss
        
        # Backward pass
        loss.backward()
        torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
        self.optimizer.step()
        
        return {
            'loss': loss.item(),
            'data_loss': data_loss.item(),
            'physics_loss': phys_loss.item(),
            'lr': self.optimizer.param_groups[0]['lr']
        }
    
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
        losses = []
        data_losses = []
        phys_losses = []
        
        for epoch in range(epochs):
            # Shuffle data
            indices = torch.randperm(x_data.size(0))
            x_data_shuffled = x_data[indices]
            y_data_shuffled = y_data[indices]
            
            epoch_loss = 0
            epoch_data_loss = 0
            epoch_phys_loss = 0
            num_batches = 0
            
            for i in range(0, x_data.size(0), batch_size):
                batch_x = x_data_shuffled[i:i+batch_size]
                batch_y = y_data_shuffled[i:i+batch_size]
                
                # Random physics points
                phys_indices = torch.randperm(x_phys.size(0))[:batch_size]
                batch_x_phys = x_phys[phys_indices]
                
                # Training step
                result = self.train_step(batch_x, batch_y, batch_x_phys, **physics_kwargs)
                
                epoch_loss += result['loss']
                epoch_data_loss += result['data_loss']
                epoch_phys_loss += result['physics_loss']
                num_batches += 1
            
            avg_loss = epoch_loss / num_batches
            avg_data_loss = epoch_data_loss / num_batches
            avg_phys_loss = epoch_phys_loss / num_batches
            
            losses.append(avg_loss)
            data_losses.append(avg_data_loss)
            phys_losses.append(avg_phys_loss)
            
            # Update scheduler
            self.scheduler.step(avg_loss)
            
            if (epoch + 1) % 100 == 0:
                logger.info(
                    f"Epoch {epoch+1}/{epochs}: Loss={avg_loss:.4f}, "
                    f"Data={avg_data_loss:.4f}, Physics={avg_phys_loss:.4f}"
                )
        
        return {
            'losses': losses,
            'data_losses': data_losses,
            'physics_losses': phys_losses,
            'final_loss': losses[-1],
            'final_data_loss': data_losses[-1],
            'final_physics_loss': phys_losses[-1]
        }
    
    def predict(self, x: torch.Tensor) -> np.ndarray:
        """Make predictions"""
        self.model.eval()
        with torch.no_grad():
            x = x.to(self.device)
            predictions = self.model(x)
        return predictions.cpu().numpy()
    
    def save(self, path: str = "models/pinns_model.pth"):
        """Save model"""
        torch.save({
            'model_state_dict': self.model.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict()
        }, path)
        logger.info(f"✅ Model saved to {path}")
    
    def load(self, path: str = "models/pinns_model.pth"):
        """Load model"""
        checkpoint = torch.load(path, map_location=self.device)
        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
        logger.info(f"✅ Model loaded from {path}")