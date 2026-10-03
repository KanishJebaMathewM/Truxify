"""
Tests for Traffic and Price Forecast Transformers (Issue #7195)
Verifies that the forward() method is correctly implemented and dispatches
to the underlying TimeSeriesTransformer without raising NotImplementedError.
"""

import pytest
import torch
from backend.ml.transformers.model import (
    TrafficForecastTransformer,
    PriceForecastTransformer,
    DemandForecastTransformer
)

class TestForecastTransformersForward:
    
    @pytest.fixture
    def batch_size(self):
        return 4

    def test_traffic_transformer_forward_pass(self, batch_size):
        """TrafficForecastTransformer must implement forward() to avoid 500 errors."""
        model = TrafficForecastTransformer(input_dim=5, seq_len=48, pred_len=12)
        x = torch.randn(batch_size, 48, 5)
        
        # This previously raised NotImplementedError
        output = model(x)
        
        assert output is not None
        assert output.shape == (batch_size, 12)
        assert not torch.isnan(output).any()

    def test_price_transformer_forward_pass(self, batch_size):
        """PriceForecastTransformer must implement forward() to avoid 500 errors."""
        model = PriceForecastTransformer(input_dim=6, seq_len=96, pred_len=24)
        x = torch.randn(batch_size, 96, 6)
        
        # This previously raised NotImplementedError
        output = model(x)
        
        assert output is not None
        assert output.shape == (batch_size, 24)
        assert not torch.isnan(output).any()

    def test_demand_transformer_still_works(self, batch_size):
        """Regression test: DemandForecastTransformer should continue working."""
        model = DemandForecastTransformer(input_dim=8, seq_len=72, pred_len=24)
        x = torch.randn(batch_size, 72, 8)
        
        output = model(x)
        
        assert output is not None
        assert output.shape == (batch_size, 24)

    def test_traffic_transformer_gradients_flow(self, batch_size):
        """Ensure gradients flow correctly through the forward pass for training."""
        model = TrafficForecastTransformer(input_dim=5, seq_len=48, pred_len=12)
        x = torch.randn(batch_size, 48, 5, requires_grad=True)
        target = torch.randn(batch_size, 12)
        
        output = model(x)
        loss = torch.nn.MSELoss()(output, target)
        loss.backward()
        
        # Check that gradients are populated
        assert x.grad is not None
        assert x.grad.shape == x.shape
        
        # Check model parameters have gradients
        for param in model.parameters():
            if param.requires_grad:
                assert param.grad is not None

    def test_price_transformer_eval_mode(self, batch_size):
        """Verify model behaves correctly in eval mode (e.g., dropout disabled)."""
        model = PriceForecastTransformer(input_dim=6, seq_len=96, pred_len=24, dropout=0.5)
        model.eval()
        
        x = torch.randn(batch_size, 96, 6)
        
        with torch.no_grad():
            out1 = model(x)
            out2 = model(x)
            
        # In eval mode, dropout is disabled, so outputs should be identical
        assert torch.allclose(out1, out2)
