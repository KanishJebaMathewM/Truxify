"""
Integration tests for the TransformerTrainer using the fixed forecast models.
Ensures that the /train endpoints will no longer crash with 500 errors.
"""

import pytest
import torch
from backend.ml.transformers.model import (
    TrafficForecastTransformer,
    PriceForecastTransformer,
    TransformerTrainer
)

class TestTransformerTrainingPipeline:
    
    @pytest.fixture
    def device(self):
        return "cuda" if torch.cuda.is_available() else "cpu"

    def test_traffic_trainer_single_step(self, device):
        """Verify Trainer.train_step works with TrafficForecastTransformer."""
        model = TrafficForecastTransformer(input_dim=5, seq_len=48, pred_len=12)
        trainer = TransformerTrainer(model, lr=1e-4, device=device)
        
        batch_x = torch.randn(8, 48, 5)
        batch_y = torch.randn(8, 12)
        
        loss = trainer.train_step(batch_x, batch_y)
        
        assert isinstance(loss, float)
        assert loss > 0

    def test_price_trainer_single_step(self, device):
        """Verify Trainer.train_step works with PriceForecastTransformer."""
        model = PriceForecastTransformer(input_dim=6, seq_len=96, pred_len=24)
        trainer = TransformerTrainer(model, lr=1e-4, device=device)
        
        batch_x = torch.randn(8, 96, 6)
        batch_y = torch.randn(8, 24)
        
        loss = trainer.train_step(batch_x, batch_y)
        
        assert isinstance(loss, float)
        assert loss > 0

    def test_trainer_predict_returns_numpy(self, device):
        """Verify Trainer.predict returns a numpy array for API serialization."""
        model = TrafficForecastTransformer(input_dim=5, seq_len=48, pred_len=12)
        trainer = TransformerTrainer(model, device=device)
        
        x = torch.randn(4, 48, 5)
        predictions = trainer.predict(x)
        
        import numpy as np
        assert isinstance(predictions, np.ndarray)
        assert predictions.shape == (4, 12)

    def test_trainer_full_epoch_loop(self, device):
        """Run a minimal full training loop to ensure no runtime errors."""
        model = PriceForecastTransformer(input_dim=6, seq_len=96, pred_len=24, num_layers=1)
        trainer = TransformerTrainer(model, device=device)
        
        # Small dataset for fast CI execution
        train_x = torch.randn(32, 96, 6)
        train_y = torch.randn(32, 24)
        val_x = torch.randn(8, 96, 6)
        val_y = torch.randn(8, 24)
        
        results = trainer.train(
            train_data=train_x,
            train_labels=train_y,
            epochs=2,
            batch_size=16,
            val_data=val_x,
            val_labels=val_y
        )
        
        assert 'train_losses' in results
        assert len(results['train_losses']) == 2
        assert results['final_loss'] is not None
