import pytest
import torch
from diffusion.model import SinusoidalPositionEmbedding, AttentionBlock

class TestDiffusionComponents:
    def test_sinusoidal_position_embedding(self):
        dim = 64
        emb = SinusoidalPositionEmbedding(dim)
        timesteps = torch.tensor([1, 10, 100])
        output = emb(timesteps)
        assert output.shape == (3, dim)

    def test_attention_block(self):
        dim = 64
        attn = AttentionBlock(dim=dim, num_heads=4)
        x = torch.randn(2, 10, dim)
        out = attn(x)
        assert out.shape == (2, 10, dim)
