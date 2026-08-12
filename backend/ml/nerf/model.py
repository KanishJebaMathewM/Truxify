import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
from typing import Dict, List, Tuple, Optional
import logging

logger = logging.getLogger(__name__)

class PositionalEncoding(nn.Module):
    """Positional encoding for NeRF"""
    
    def __init__(self, num_frequencies: int = 10):
        super().__init__()
        self.num_frequencies = num_frequencies
        
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (..., 3) for positions or (..., 2) for directions
        encoding = [x]
        for i in range(self.num_frequencies):
            freq = 2 ** i
            encoding.append(torch.sin(freq * x))
            encoding.append(torch.cos(freq * x))
        return torch.cat(encoding, dim=-1)

class NeRFNetwork(nn.Module):
    """Neural Radiance Field Network"""
    
    def __init__(
        self,
        num_frequencies: int = 10,
        num_dir_frequencies: int = 4,
        hidden_dim: int = 256,
        num_layers: int = 8,
        skip_layer: int = 4
    ):
        super().__init__()
        
        self.num_frequencies = num_frequencies
        self.num_dir_frequencies = num_dir_frequencies
        
        # Position encoding
        self.pos_encoder = PositionalEncoding(num_frequencies)
        self.dir_encoder = PositionalEncoding(num_dir_frequencies)
        
        # Input dimension: 3 + 3*2*num_frequencies
        input_dim = 3 + 3 * 2 * num_frequencies
        dir_input_dim = 3 + 3 * 2 * num_dir_frequencies
        
        # Density network
        layers = []
        for i in range(num_layers):
            if i == 0:
                layers.append(nn.Linear(input_dim, hidden_dim))
            elif i == skip_layer:
                layers.append(nn.Linear(hidden_dim + input_dim, hidden_dim))
            else:
                layers.append(nn.Linear(hidden_dim, hidden_dim))
            layers.append(nn.ReLU())
        
        self.density_layers = nn.Sequential(*layers)
        self.density_head = nn.Linear(hidden_dim, 1)
        
        # Color network
        self.color_layers = nn.Sequential(
            nn.Linear(hidden_dim + dir_input_dim, hidden_dim // 2),
            nn.ReLU(),
            nn.Linear(hidden_dim // 2, 3),
            nn.Sigmoid()
        )
        
        logger.info(f"✅ NeRF model initialized with {num_layers} layers")
    
    def forward(
        self,
        points: torch.Tensor,
        directions: torch.Tensor
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Forward pass
        points: (..., 3) - 3D points
        directions: (..., 3) - viewing directions
        Returns: (density, color)
        """
        # Encode positions and directions
        encoded_pos = self.pos_encoder(points)
        encoded_dir = self.dir_encoder(directions)
        
        # Density computation
        x = encoded_pos
        for i, layer in enumerate(self.density_layers):
            if i == 0:
                x = layer(x)
            elif i == 4:  # Skip connection
                x = torch.cat([x, encoded_pos], dim=-1)
                x = layer(x)
            else:
                x = layer(x)
        
        density = self.density_head(x)
        
        # Color computation
        color_input = torch.cat([x, encoded_dir], dim=-1)
        color = self.color_layers(color_input)
        
        return density, color

class NeRFRenderer:
    """NeRF Renderer for 3D Scene Reconstruction"""
    
    def __init__(
        self,
        model: NeRFNetwork,
        near: float = 0.1,
        far: float = 10.0,
        num_samples: int = 64,
        device: str = "cuda" if torch.cuda.is_available() else "cpu"
    ):
        self.model = model.to(device)
        self.near = near
        self.far = far
        self.num_samples = num_samples
        self.device = device
        
        logger.info(f"✅ NeRF Renderer initialized on {device}")
    
    def render_rays(
        self,
        ray_origins: torch.Tensor,
        ray_directions: torch.Tensor,
        num_samples: Optional[int] = None
    ) -> Dict:
        """Render rays through the scene"""
        if num_samples is None:
            num_samples = self.num_samples
        
        # Sample points along rays
        t_values = torch.linspace(self.near, self.far, num_samples, device=self.device)
        t_values = t_values.unsqueeze(0).unsqueeze(0).expand(
            ray_origins.shape[0], ray_origins.shape[1], -1
        )
        
        # Compute 3D points
        points = ray_origins.unsqueeze(-2) + ray_directions.unsqueeze(-2) * t_values.unsqueeze(-1)
        
        # Normalize directions
        dirs = F.normalize(ray_directions, dim=-1)
        dirs = dirs.unsqueeze(-2).expand(-1, -1, num_samples, -1)
        
        # Reshape for network
        points_flat = points.reshape(-1, 3)
        dirs_flat = dirs.reshape(-1, 3)
        
        # Query network
        with torch.no_grad():
            densities, colors = self.model(points_flat, dirs_flat)
        
        # Reshape back
        densities = densities.reshape(ray_origins.shape[0], ray_origins.shape[1], num_samples, 1)
        colors = colors.reshape(ray_origins.shape[0], ray_origins.shape[1], num_samples, 3)
        
        # Volume rendering
        delta = t_values[..., 1:] - t_values[..., :-1]
        delta = torch.cat([delta, torch.full_like(delta[..., -1:], 1e10)], dim=-1)
        
        alpha = 1 - torch.exp(-densities * delta)
        weights = alpha * torch.cumprod(1 - alpha + 1e-10, dim=-2)
        
        # Compute RGB
        rgb = (weights * colors).sum(dim=-2)
        depth = (weights * t_values).sum(dim=-2)
        
        return {
            'rgb': rgb,
            'depth': depth,
            'weights': weights,
            'alpha': alpha
        }
    
    def render_image(
        self,
        camera_rays: Dict,
        image_size: Tuple[int, int] = (256, 256)
    ) -> Dict:
        """Render full image"""
        ray_origins = camera_rays['origins']
        ray_directions = camera_rays['directions']
        
        # Render all rays
        result = self.render_rays(ray_origins, ray_directions)
        
        # Reshape to image
        h, w = image_size
        rgb = result['rgb'].reshape(h, w, 3)
        depth = result['depth'].reshape(h, w)
        
        return {
            'rgb': rgb,
            'depth': depth,
            'weights': result['weights'].reshape(h, w, -1),
            'alpha': result['alpha'].reshape(h, w, -1)
        }
    
    def render_video(
        self,
        camera_poses: List[Dict],
        image_size: Tuple[int, int] = (256, 256)
    ) -> List[Dict]:
        """Render video from camera poses"""
        frames = []
        for pose in camera_poses:
            frame = self.render_image(pose, image_size)
            frames.append(frame)
        return frames

class NeRFTrainer:
    """NeRF Trainer"""
    
    def __init__(
        self,
        model: NeRFNetwork,
        lr: float = 5e-4,
        device: str = "cuda" if torch.cuda.is_available() else "cpu"
    ):
        self.model = model.to(device)
        self.device = device
        self.optimizer = torch.optim.Adam(model.parameters(), lr=lr)
        
        logger.info(f"✅ NeRF Trainer initialized on {device}")
    
    def train_step(
        self,
        points: torch.Tensor,
        directions: torch.Tensor,
        target_rgb: torch.Tensor
    ) -> float:
        """Single training step"""
        self.model.train()
        self.optimizer.zero_grad()
        
        # Forward pass
        densities, colors = self.model(points, directions)
        
        # Compute loss
        loss = F.mse_loss(colors, target_rgb)
        
        # Backward pass
        loss.backward()
        self.optimizer.step()
        
        return loss.item()
    
    def train(
        self,
        train_data: Dict,
        epochs: int = 100,
        batch_size: int = 4096
    ) -> Dict:
        """Train NeRF model"""
        losses = []
        
        points = train_data['points']
        directions = train_data['directions']
        rgb = train_data['rgb']
        
        for epoch in range(epochs):
            total_loss = 0
            num_batches = 0
            
            # Random sampling
            indices = torch.randperm(points.shape[0])
            for i in range(0, points.shape[0], batch_size):
                batch_idx = indices[i:i+batch_size]
                
                loss = self.train_step(
                    points[batch_idx],
                    directions[batch_idx],
                    rgb[batch_idx]
                )
                
                total_loss += loss
                num_batches += 1
            
            avg_loss = total_loss / num_batches
            losses.append(avg_loss)
            
            if (epoch + 1) % 10 == 0:
                logger.info(f"Epoch {epoch + 1}/{epochs} - Loss: {avg_loss:.4f}")
        
        return {'losses': losses, 'final_loss': losses[-1]}
    
    def save(self, path: str = "models/nerf.pth"):
        """Save model"""
        torch.save({
            'model_state_dict': self.model.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict()
        }, path)
        logger.info(f"✅ Model saved to {path}")
    
    def load(self, path: str = "models/nerf.pth"):
        """Load model"""
        checkpoint = torch.load(path, map_location=self.device)
        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
        logger.info(f"✅ Model loaded from {path}")