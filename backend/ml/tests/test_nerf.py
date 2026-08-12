import pytest
import torch
from nerf.model import PositionalEncoding

class TestNeRFModel:
    def test_positional_encoding_init(self):
        pe = PositionalEncoding(num_frequencies=6)
        assert pe is not None
        assert hasattr(pe, 'forward')
