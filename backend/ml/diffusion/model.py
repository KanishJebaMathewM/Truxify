import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
from typing import Dict, List, Tuple, Optional
import logging
from tqdm import tqdm

logger = logging.getLogger(__name__)

class SinusoidalPositionEmbedding(nn.Module):
    """Sinusoidal position embeddings for diffusion timesteps"""
    
    def __init__(self, dim: int):
        super().__init__()
        self.dim = dim
    
    def forward(self, timesteps: torch.Tensor) -> torch.Tensor:
        half_dim = self.dim // 2
        emb = torch.log(torch.tensor(10000.0)) / (half_dim - 1)
        emb = torch.exp(torch.arange(half_dim, device=timesteps.device) * -emb)
        emb = timesteps.unsqueeze(1) * emb.unsqueeze(0)
        return torch.cat([torch.sin(emb), torch.cos(emb)], dim=1)

class AttentionBlock(nn.Module):
    """Self-attention block for diffusion model"""
    
    def __init__(self, dim: int, num_heads: int = 8):
        super().__init__()
        self.num_heads = num_heads
        self.scale = (dim // num_heads) ** -0.5
        
        self.qkv = nn.Linear(dim, dim * 3)
        self.proj = nn.Linear(dim, dim)
        
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        B, N, D = x.shape
        qkv = self.qkv(x).reshape(B, N, 3, self.num_heads, D // self.num_heads)
        qkv = qkv.permute(2, 0, 3, 1, 4)
        q, k, v = qkv[0], qkv[1], qkv[2]
        
        attn = (q @ k.transpose(-2, -1)) * self.scale
        attn = attn.softmax(dim=-1)
        
        x = (attn @ v).transpose(1, 2).reshape(B, N, D)
        x = self.proj(x)
        return x

class ResBlock(nn.Module):
    """Residual block with time embedding"""
    
    def __init__(self, dim: int, time_dim: int, dropout: float = 0.1):
        super().__init__()
        self.norm1 = nn.LayerNorm(dim)
        self.norm2 = nn.LayerNorm(dim)
        self.linear1 = nn.Linear(dim, dim)
        self.linear2 = nn.Linear(dim, dim)
        self.time_mlp = nn.Linear(time_dim, dim)
        self.dropout = nn.Dropout(dropout)
        
    def forward(self, x: torch.Tensor, time_emb: torch.Tensor) -> torch.Tensor:
        residual = x
        
        # First block
        x = self.norm1(x)
        x = self.linear1(x)
        x = F.gelu(x)
        x = self.dropout(x)
        
        # Add time embedding
        time_emb = self.time_mlp(time_emb)
        x = x + time_emb.unsqueeze(1)
        
        # Second block
        x = self.norm2(x)
        x = self.linear2(x)
        x = F.gelu(x)
        x = self.dropout(x)
        
        return x + residual

class DiffusionRouteModel(nn.Module):
    """Diffusion model for route generation"""
    
    def __init__(
        self,
        input_dim: int = 64,
        hidden_dim: int = 256,
        num_layers: int = 4,
        num_heads: int = 8,
        num_timesteps: int = 1000
    ):
        super().__init__()
        
        self.input_dim = input_dim
        self.hidden_dim = hidden_dim
        self.num_timesteps = num_timesteps
        
        # Time embedding
        self.time_embed = SinusoidalPositionEmbedding(hidden_dim)
        self.time_mlp = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim),
            nn.GELU(),
            nn.Linear(hidden_dim, hidden_dim)
        )
        
        # Input projection
        self.input_proj = nn.Linear(input_dim, hidden_dim)
        
        # Diffusion blocks
        self.blocks = nn.ModuleList()
        for _ in range(num_layers):
            self.blocks.append(ResBlock(hidden_dim, hidden_dim))
            self.blocks.append(AttentionBlock(hidden_dim, num_heads))
        
        # Output projection
        self.output_proj = nn.Sequential(
            nn.LayerNorm(hidden_dim),
            nn.Linear(hidden_dim, hidden_dim),
            nn.GELU(),
            nn.Linear(hidden_dim, input_dim)
        )
        
        logger.info(f"✅ Diffusion model initialized with {num_layers} layers")
    
    def forward(self, x: torch.Tensor, timesteps: torch.Tensor) -> torch.Tensor:
        # Time embedding
        t_emb = self.time_embed(timesteps)
        t_emb = self.time_mlp(t_emb)
        
        # Input projection
        x = self.input_proj(x)
        
        # Diffusion blocks
        for block in self.blocks:
            if isinstance(block, ResBlock):
                x = block(x, t_emb)
            else:
                x = block(x)
        
        # Output projection
        x = self.output_proj(x)
        return x

class DiffusionRouteGenerator:
    """Diffusion model for route generation"""
    
    def __init__(
        self,
        model: DiffusionRouteModel,
        device: str = "cuda" if torch.cuda.is_available() else "cpu"
    ):
        self.model = model.to(device)
        self.device = device
        self.num_timesteps = model.num_timesteps
        
        # Noise schedule (linear beta schedule)
        self.betas = self._get_linear_beta_schedule()
        self.alphas = 1.0 - self.betas
        self.alpha_bars = torch.cumprod(self.alphas, dim=0)
        
        logger.info(f"✅ Route generator initialized on {device}")
    
    def _get_linear_beta_schedule(self) -> torch.Tensor:
        """Linear beta schedule from 1e-4 to 2e-2"""
        start = 1e-4
        end = 2e-2
        return torch.linspace(start, end, self.num_timesteps)
    
    def _extract(self, a: torch.Tensor, t: torch.Tensor, x_shape: Tuple) -> torch.Tensor:
        """Extract values from tensor at timesteps"""
        batch_size = t.shape[0]
        out = a.gather(-1, t)
        return out.reshape(batch_size, *((1,) * (len(x_shape) - 1)))
    
    def add_noise(
        self,
        x_start: torch.Tensor,
        t: torch.Tensor,
        noise: Optional[torch.Tensor] = None
    ) -> torch.Tensor:
        """Add noise to data at timestep t"""
        if noise is None:
            noise = torch.randn_like(x_start)
        
        sqrt_alpha_bar = torch.sqrt(self._extract(self.alpha_bars, t, x_start.shape))
        sqrt_one_minus_alpha_bar = torch.sqrt(1 - self._extract(self.alpha_bars, t, x_start.shape))
        
        return sqrt_alpha_bar * x_start + sqrt_one_minus_alpha_bar * noise
    
    def denoise(
        self,
        x_t: torch.Tensor,
        t: torch.Tensor,
        condition: Optional[torch.Tensor] = None
    ) -> torch.Tensor:
        """Denoise data at timestep t"""
        # Combine with condition if provided
        if condition is not None:
            x_t = torch.cat([x_t, condition], dim=-1)
        
        # Predict noise
        predicted_noise = self.model(x_t, t)
        return predicted_noise
    
    def generate(
        self,
        shape: Tuple,
        condition: Optional[torch.Tensor] = None,
        num_steps: Optional[int] = None
    ) -> torch.Tensor:
        """Generate route using reverse diffusion"""
        if num_steps is None:
            num_steps = self.num_timesteps
        
        # Start from pure noise
        x = torch.randn(shape, device=self.device)
        
        # Reverse diffusion
        for i in tqdm(range(num_steps - 1, -1, -1), desc="Generating"):
            t = torch.tensor([i] * shape[0], device=self.device)
            
            # Predict noise
            noise_pred = self.denoise(x, t, condition)
            
            # Update x
            alpha = self._extract(self.alphas, t, x.shape)
            alpha_bar = self._extract(self.alpha_bars, t, x.shape)
            beta = self._extract(self.betas, t, x.shape)
            
            if i > 0:
                z = torch.randn_like(x)
            else:
                z = torch.zeros_like(x)
            
            x = (x - (1 - alpha) / torch.sqrt(1 - alpha_bar) * noise_pred) / torch.sqrt(alpha)
            x = x + torch.sqrt(beta) * z
        
        return x
    
    def generate_route(
        self,
        start_point: torch.Tensor,
        end_point: torch.Tensor,
        condition: Optional[torch.Tensor] = None
    ) -> torch.Tensor:
        """Generate optimal route between start and end"""
        # Prepare input
        route_input = torch.cat([start_point, end_point], dim=-1)
        
        # Generate route
        route = self.generate(route_input.shape, condition)
        
        return route
    
    def sample(
        self,
        batch_size: int = 1,
        route_length: int = 50,
        condition: Optional[torch.Tensor] = None
    ) -> torch.Tensor:
        """Sample routes from model"""
        shape = (batch_size, route_length, self.model.input_dim)
        return self.generate(shape, condition)
    
    def conditional_generate(
        self,
        condition: torch.Tensor,
        shape: Optional[Tuple] = None
    ) -> torch.Tensor:
        """Generate route conditioned on weather/time"""
        if shape is None:
            shape = (condition.shape[0], 50, self.model.input_dim)
        
        return self.generate(shape, condition)
    
    def save(self, path: str = "models/diffusion_route.pth"):
        """Save model"""
        torch.save({
            'model_state_dict': self.model.state_dict(),
            'num_timesteps': self.num_timesteps,
            'input_dim': self.model.input_dim,
            'hidden_dim': self.model.hidden_dim
        }, path)
        logger.info(f"✅ Model saved to {path}")
    
    def load(self, path: str = "models/diffusion_route.pth"):
        """Load model"""
        checkpoint = torch.load(path, map_location=self.device)
        self.model.load_state_dict(checkpoint['model_state_dict'])
        logger.info(f"✅ Model loaded from {path}")