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
        emb = torch.log(torch.tensor(10000.0, device=timesteps.device)) / (half_dim - 1)
        emb = torch.exp(torch.arange(half_dim, device=timesteps.device, dtype=torch.float32) * -emb)
        emb = timesteps.float().unsqueeze(1) * emb.unsqueeze(0)
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
        t_emb = self.time_mlp(time_emb)
        x = x + t_emb.unsqueeze(1)
        
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
        num_timesteps: int = 1000,
        cond_dim: Optional[int] = None
    ):
        super().__init__()
        
        self.input_dim = input_dim
        self.hidden_dim = hidden_dim
        self.num_timesteps = num_timesteps
        self.cond_dim = cond_dim
        
        # Time embedding
        self.time_embed = SinusoidalPositionEmbedding(hidden_dim)
        self.time_mlp = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim),
            nn.GELU(),
            nn.Linear(hidden_dim, hidden_dim)
        )
        
        # Input projection
        self.input_proj = nn.Linear(input_dim, hidden_dim)

        # Condition projection layer
        self.cond_proj = nn.Linear(cond_dim, hidden_dim) if cond_dim else None

        # Noise schedule (linear beta schedule)
        self.register_buffer('betas', self._get_linear_beta_schedule())
        self.register_buffer('alphas', 1.0 - self.betas)
        self.register_buffer('alpha_bars', torch.cumprod(self.alphas, dim=0))
        
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

    def _get_linear_beta_schedule(self) -> torch.Tensor:
        """Linear beta schedule from 1e-4 to 2e-2."""
        start = 1e-4
        end = 2e-2
        return torch.linspace(start, end, self.num_timesteps)

    def _extract(self, a: torch.Tensor, t: torch.Tensor, x_shape: Tuple) -> torch.Tensor:
        """Extract values from tensor at timesteps."""
        batch_size = t.shape[0]
        out = a.to(t.device).gather(-1, t)
        return out.reshape(batch_size, *((1,) * (len(x_shape) - 1)))

    def add_noise(
        self,
        x_start: torch.Tensor,
        t: torch.Tensor,
        noise: Optional[torch.Tensor] = None
    ) -> torch.Tensor:
        """Add noise to data at timestep t."""
        if noise is None:
            noise = torch.randn_like(x_start)

        sqrt_alpha_bar = torch.sqrt(self._extract(self.alpha_bars, t, x_start.shape))
        sqrt_one_minus_alpha_bar = torch.sqrt(1.0 - self._extract(self.alpha_bars, t, x_start.shape))

        return sqrt_alpha_bar * x_start + sqrt_one_minus_alpha_bar * noise

    def denoise(
        self,
        x_t: torch.Tensor,
        t: torch.Tensor,
        condition: Optional[torch.Tensor] = None
    ) -> torch.Tensor:
        """Predict noise for noisy tensor at timestep t given optional condition."""
        return self.forward(x_t, t, condition=condition)
    
    def forward(
        self,
        x: torch.Tensor,
        timesteps: torch.Tensor,
        condition: Optional[torch.Tensor] = None
    ) -> torch.Tensor:
        """Forward pass through diffusion backbone with condition embedding."""
        if x.shape[-1] > self.input_dim:
            inferred_cond = x[..., self.input_dim:]
            x = x[..., :self.input_dim]
            if condition is None:
                condition = inferred_cond

        # Time embedding
        t_emb = self.time_embed(timesteps)
        t_emb = self.time_mlp(t_emb)
        
        # Input projection
        x = self.input_proj(x)

        # Condition projection
        if condition is not None:
            if not isinstance(condition, torch.Tensor):
                condition = torch.tensor(condition, dtype=torch.float32, device=x.device)
            elif condition.device != x.device:
                condition = condition.to(x.device)
            if condition.dtype not in (torch.float32, torch.float64):
                condition = condition.float()

            if condition.dim() == 1:
                condition = condition.unsqueeze(0)

            cond_in = condition.shape[-1]
            if self.cond_proj is None or self.cond_proj.in_features != cond_in:
                self.cond_proj = nn.Linear(cond_in, self.hidden_dim).to(x.device)

            c = self.cond_proj(condition)
            if c.dim() == 2:
                c = c.unsqueeze(1)
            x = x + c
        
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
    """Diffusion model for route generation wrapper"""
    
    def __init__(
        self,
        model: DiffusionRouteModel,
        device: str = "cuda" if torch.cuda.is_available() else "cpu"
    ):
        self.model = model.to(device)
        self.device = device
        self.num_timesteps = model.num_timesteps
        
        self.betas = self.model.betas.to(device)
        self.alphas = self.model.alphas.to(device)
        self.alpha_bars = self.model.alpha_bars.to(device)
        
        logger.info(f"✅ Route generator initialized on {device}")
    
    def _extract(self, a: torch.Tensor, t: torch.Tensor, x_shape: Tuple) -> torch.Tensor:
        """Extract values from tensor at timesteps"""
        batch_size = t.shape[0]
        out = a.to(t.device).gather(-1, t)
        return out.reshape(batch_size, *((1,) * (len(x_shape) - 1)))
    
    def add_noise(
        self,
        x_start: torch.Tensor,
        t: torch.Tensor,
        noise: Optional[torch.Tensor] = None
    ) -> torch.Tensor:
        """Add noise to data at timestep t"""
        return self.model.add_noise(
            x_start.to(self.device),
            t.to(self.device),
            noise.to(self.device) if noise is not None else None
        )
    
    def denoise(
        self,
        x_t: torch.Tensor,
        t: torch.Tensor,
        condition: Optional[torch.Tensor] = None
    ) -> torch.Tensor:
        """Denoise data at timestep t with condition projection"""
        return self.model.denoise(x_t, t, condition=condition)
    
    @torch.no_grad()
    def generate(
        self,
        shape: Tuple,
        condition: Optional[torch.Tensor] = None,
        num_steps: Optional[int] = None,
        start_point: Optional[torch.Tensor] = None,
        end_point: Optional[torch.Tensor] = None
    ) -> torch.Tensor:
        """Generate route using reverse diffusion with optional endpoint boundary constraints"""
        if num_steps is None:
            num_steps = self.num_timesteps
        
        x = torch.randn(shape, device=self.device)
        
        for i in tqdm(range(num_steps - 1, -1, -1), desc="Generating"):
            t = torch.tensor([i] * shape[0], device=self.device)

            if start_point is not None and end_point is not None:
                if i > 0:
                    x[:, 0, :] = self.add_noise(start_point, t)
                    x[:, -1, :] = self.add_noise(end_point, t)
                else:
                    x[:, 0, :] = start_point
                    x[:, -1, :] = end_point
            
            noise_pred = self.denoise(x, t, condition=condition)
            
            alpha = self._extract(self.alphas, t, x.shape)
            alpha_bar = self._extract(self.alpha_bars, t, x.shape)
            beta = self._extract(self.betas, t, x.shape)
            
            z = torch.randn_like(x) if i > 0 else torch.zeros_like(x)
            
            x = (x - (1.0 - alpha) / torch.sqrt(1.0 - alpha_bar) * noise_pred) / torch.sqrt(alpha)
            x = x + torch.sqrt(beta) * z

        if start_point is not None and end_point is not None:
            x[:, 0, :] = start_point
            x[:, -1, :] = end_point
        
        return x.detach()
    
    @torch.no_grad()
    def generate_route(
        self,
        start_point: torch.Tensor,
        end_point: torch.Tensor,
        condition: Optional[torch.Tensor] = None,
        route_length: int = 50,
        num_steps: Optional[int] = None
    ) -> torch.Tensor:
        """Generate optimal route between start and end with boundary conditioning"""
        if not isinstance(start_point, torch.Tensor):
            start_point = torch.tensor(start_point, dtype=torch.float32, device=self.device)
        else:
            start_point = start_point.to(device=self.device, dtype=torch.float32)

        if not isinstance(end_point, torch.Tensor):
            end_point = torch.tensor(end_point, dtype=torch.float32, device=self.device)
        else:
            end_point = end_point.to(device=self.device, dtype=torch.float32)

        if start_point.dim() == 1:
            start_point = start_point.unsqueeze(0)
        elif start_point.dim() == 3:
            start_point = start_point.squeeze(1)

        if end_point.dim() == 1:
            end_point = end_point.unsqueeze(0)
        elif end_point.dim() == 3:
            end_point = end_point.squeeze(1)

        batch_size = start_point.shape[0]
        if end_point.shape[0] == 1 and batch_size > 1:
            end_point = end_point.expand(batch_size, -1)

        D = self.model.input_dim
        if start_point.shape[-1] != D:
            sp = torch.zeros(batch_size, D, device=self.device)
            sp[:, :min(start_point.shape[-1], D)] = start_point[:, :min(start_point.shape[-1], D)]
            start_point = sp

        if end_point.shape[-1] != D:
            ep = torch.zeros(batch_size, D, device=self.device)
            ep[:, :min(end_point.shape[-1], D)] = end_point[:, :min(end_point.shape[-1], D)]
            end_point = ep

        boundary_cond = torch.cat([start_point, end_point], dim=-1)
        if condition is not None:
            if not isinstance(condition, torch.Tensor):
                condition = torch.tensor(condition, dtype=torch.float32, device=self.device)
            else:
                condition = condition.to(device=self.device, dtype=torch.float32)
            if condition.dim() == 1:
                condition = condition.unsqueeze(0)
            if condition.shape[0] == 1 and batch_size > 1:
                condition = condition.expand(batch_size, -1)
            combined_cond = torch.cat([boundary_cond, condition], dim=-1)
        else:
            combined_cond = boundary_cond

        shape = (batch_size, route_length, D)
        route = self.generate(
            shape,
            condition=combined_cond,
            num_steps=num_steps,
            start_point=start_point,
            end_point=end_point
        )
        return route.detach()
    
    @torch.no_grad()
    def sample(
        self,
        batch_size: int = 1,
        route_length: int = 50,
        condition: Optional[torch.Tensor] = None,
        num_steps: Optional[int] = None
    ) -> torch.Tensor:
        """Sample routes from model"""
        shape = (batch_size, route_length, self.model.input_dim)
        return self.generate(shape, condition=condition, num_steps=num_steps)
    
    @torch.no_grad()
    def conditional_generate(
        self,
        condition: torch.Tensor,
        shape: Optional[Tuple] = None,
        num_steps: Optional[int] = None
    ) -> torch.Tensor:
        """Generate route conditioned on weather/time/environment context"""
        if not isinstance(condition, torch.Tensor):
            condition = torch.tensor(condition, dtype=torch.float32, device=self.device)
        else:
            condition = condition.to(device=self.device, dtype=torch.float32)
        if condition.dim() == 1:
            condition = condition.unsqueeze(0)

        if shape is None:
            shape = (condition.shape[0], 50, self.model.input_dim)
        
        return self.generate(shape, condition=condition, num_steps=num_steps)
    
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
