import pytest
import torch
from transformers.model import TimeSeriesTransformer

class TestTimeSeriesTransformer:
    def test_transformer_init(self):
        model = TimeSeriesTransformer(seq_len=60, pred_len=12, d_model=64)
        assert model is not None
        assert hasattr(model, 'forward')
