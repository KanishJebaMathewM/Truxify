import pytest
import torch
import numpy as np
from transformers.model import (
    TimeSeriesTransformer,
    TransformerTrainer,
    DemandForecastTransformer
)
from routes.transformer_routes import TrainRequest
from pydantic import ValidationError

class TestTimeSeriesTransformer:
    def test_transformer_init(self):
        model = TimeSeriesTransformer(seq_len=60, pred_len=12, d_model=64)
        assert model is not None
        assert hasattr(model, 'forward')
        
    def test_immutable_training_swap(self):
        # Test that training doesn't immediately mutate the serving model until it succeeds
        model = DemandForecastTransformer(seq_len=10, pred_len=2, d_model=16, num_layers=1, num_heads=2)
        trainer = TransformerTrainer(model, device='cpu')
        
        # Capture initial prediction
        test_input = torch.randn(1, 10, 8)
        initial_pred = trainer.predict(test_input)
        
        # Train on dummy data
        train_data = torch.randn(5, 10, 8)
        train_labels = torch.randn(5, 2)
        
        # During this, it deepcopies the model
        res = trainer.train(train_data, train_labels, epochs=2, batch_size=2)
        
        # The atomic swap should have updated the weights
        post_pred = trainer.predict(test_input)
        
        # It should differ from the initial pred since weights changed and were swapped
        assert not np.allclose(initial_pred, post_pred), "Model weights did not update after training atomic swap"

    def test_pydantic_train_request_constraints(self):
        # Test valid request
        req = TrainRequest(
            epochs=10,
            batch_size=32,
            train_data=[[[0.0]*8]*10]*5,
            train_labels=[[0.0]*2]*5
        )
        assert req.epochs == 10
        assert req.batch_size == 32
        
        # Test zero epochs
        with pytest.raises(ValidationError):
            TrainRequest(
                epochs=0,
                batch_size=32,
                train_data=[[[0.0]*8]*10]*5,
                train_labels=[[0.0]*2]*5
            )
            
        # Test zero batch size
        with pytest.raises(ValidationError):
            TrainRequest(
                epochs=10,
                batch_size=0,
                train_data=[[[0.0]*8]*10]*5,
                train_labels=[[0.0]*2]*5
            )
