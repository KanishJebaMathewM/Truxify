import logging
from typing import Optional, Tuple

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from diffusion.denoiser_admission import MAX_VALUES, admit, geometry, integer
from tqdm import tqdm

logger = logging.getLogger(__name__)

class SinusoidalPositionEmbedding(nn.Module):
    """Sinusoidal position embeddings for diffusion timesteps""" 
    
    def __init__(self, dim: int):
        super().__init__()
        self.dim = integer(dim, "embedding width", 2, 4096)
        # Tracks module dtype/device without changing legacy checkpoint keys.
        self.register_buffer("_dtype_anchor", torch.empty(0), persistent=False)

    def forward(self, timesteps: torch.Tensor) -> torch.Tensor:
        if (not isinstance(timesteps, torch.Tensor) or timesteps.layout != torch.strided
                or timesteps.ndim != 1 or timesteps.is_complex() or timesteps.dtype == torch.bool
                or timesteps.numel() * self.dim > MAX_VALUES
                or not bool(torch.isfinite(timesteps).all())):
            raise ValueError("embedding requires a bounded finite real timestep vector")
        dtype = self._dtype_anchor.dtype
        if dtype not in (torch.float32, torch.float64):
            raise ValueError("embedding supports float32 or float64")
        times = timesteps.to(dtype=dtype).clone()
        half_dim = self.dim // 2
        if half_dim == 1:
            frequencies = torch.ones(1, device=times.device, dtype=dtype)
        else:
            scale = torch.log(torch.tensor(10000.0, device=times.device, dtype=dtype)) / (half_dim - 1)
            frequencies = torch.exp(torch.arange(half_dim, device=times.device, dtype=dtype) * -scale)
        phase = times.unsqueeze(1) * frequencies.unsqueeze(0)
        result = torch.cat([torch.sin(phase), torch.cos(phase)], dim=1)
        if self.dim % 2:
            result = F.pad(result, (0, 1))
        if not bool(torch.isfinite(result).all()):
            raise ValueError("timestep phase cannot be represented in embedding dtype")
        return result

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
        
        self._base_parameters = geometry(input_dim, hidden_dim, num_layers,
                                         num_heads, num_timesteps, cond_dim)
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
        if cond_dim is not None and (isinstance(cond_dim, bool)
                or not isinstance(cond_dim, int) or cond_dim < 1):
            raise ValueError("cond_dim must be a positive integer or None")
        # Lazy parameters are registered now, so optimizers own them before the
        # first conditional batch and materialization preserves their identity.
        self.cond_proj = (nn.Linear(cond_dim, hidden_dim) if cond_dim is not None
                          else nn.LazyLinear(hidden_dim))

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
        x, timesteps, condition = admit(self, x, timesteps, condition)

        t_emb = self.time_embed(timesteps).to(dtype=self.time_mlp[0].weight.dtype)
        t_emb = self.time_mlp(t_emb)
        x = self.input_proj(x)
        if condition is not None:
            c = self.cond_proj(condition)
            if c.ndim == 2:
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
        if not bool(torch.isfinite(x).all()):
            raise RuntimeError("native denoiser produced nonfinite predictions")
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
        if (isinstance(num_steps, bool) or not isinstance(num_steps, (int, np.integer))
                or not 1 <= num_steps <= self.num_timesteps):
            raise ValueError("num_steps must be a positive integer within the training schedule")
        if (not isinstance(shape, (tuple, list)) or len(shape) != 3
                or any(isinstance(size, bool) or not isinstance(size, (int, np.integer)) or size < 1
                       for size in shape) or shape[2] != self.model.input_dim):
            raise ValueError("shape must be positive batch/sequence/input_dim dimensions")
        if (start_point is None) != (end_point is None):
            raise ValueError("start and end points must be supplied together")
        dtype = next(self.model.parameters()).dtype
        if start_point is not None:
            start_point = torch.as_tensor(start_point, device=self.device, dtype=dtype)
            end_point = torch.as_tensor(end_point, device=self.device, dtype=dtype)
            if (start_point.shape != (shape[0], shape[2]) or end_point.shape != start_point.shape
                    or not torch.isfinite(start_point).all() or not torch.isfinite(end_point).all()):
                raise ValueError("endpoints must be finite batch/input_dim rows")
        if (self.alpha_bars.shape != (self.num_timesteps,)
                or not torch.isfinite(self.alpha_bars).all()
                or not ((self.alpha_bars > 0) & (self.alpha_bars < 1)).all()):
            raise ValueError("cumulative noise schedule must be finite and strictly between zero and one")
        full_schedule = num_steps == self.num_timesteps
        timesteps = (list(range(self.num_timesteps - 1, -1, -1)) if full_schedule
                     else torch.linspace(self.num_timesteps - 1, 0, num_steps).round().long().tolist())
        modes = [(module, module.training) for module in self.model.modules()]
        try:
            self.model.eval()
            x = torch.randn(shape, device=self.device, dtype=dtype)
            for index, current in enumerate(tqdm(timesteps, desc="Generating")):
                t = torch.full((shape[0],), current, device=self.device, dtype=torch.long)
                if start_point is not None:
                    if current > 0:
                        x[:, 0, :] = self.add_noise(start_point, t)
                        x[:, -1, :] = self.add_noise(end_point, t)
                    else:
                        x[:, 0, :], x[:, -1, :] = start_point, end_point
                noise_pred = self.denoise(x, t, condition=condition)
                if noise_pred.shape != x.shape or not torch.isfinite(noise_pred).all():
                    raise RuntimeError("denoiser must return finite shape-matched noise")
                if full_schedule:
                    # Preserve the existing adjacent stochastic DDPM update.
                    alpha = self._extract(self.alphas, t, x.shape)
                    alpha_bar = self._extract(self.alpha_bars, t, x.shape)
                    beta = self._extract(self.betas, t, x.shape)
                    z = torch.randn_like(x) if current > 0 else torch.zeros_like(x)
                    x = (x - (1.0 - alpha) / torch.sqrt(1.0 - alpha_bar) * noise_pred) / torch.sqrt(alpha)
                    x = x + torch.sqrt(beta) * z
                else:
                    # DDIM eta=0 traverses selected *trained* noise levels.
                    # The virtual next index -1 is the clean alpha_bar=1 endpoint.
                    next_index = timesteps[index + 1] if index + 1 < len(timesteps) else -1
                    a_current = self.alpha_bars[current].to(dtype=x.dtype)
                    a_next = self.alpha_bars[next_index].to(dtype=x.dtype) if next_index >= 0 else x.new_tensor(1.0)
                    clean = (x - torch.sqrt(1 - a_current) * noise_pred) / torch.sqrt(a_current)
                    x = torch.sqrt(a_next) * clean + torch.sqrt(1 - a_next) * noise_pred
                if not torch.isfinite(x).all():
                    raise RuntimeError("reverse diffusion produced nonfinite coordinates")
            if start_point is not None:
                x[:, 0, :], x[:, -1, :] = start_point, end_point
            return x.detach()
        finally:
            # Restore heterogeneous child modes, not only the parent flag.
            for module, training in modes:
                module.training = training

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
