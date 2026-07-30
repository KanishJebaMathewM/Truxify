import pytest
import torch
from foundation.model import PositionalEncoding

class TestFoundationModel:
    def test_foundation_positional_encoding(self):
        pe = PositionalEncoding(d_model=64)
        assert pe is not None
        assert hasattr(pe, 'forward')
