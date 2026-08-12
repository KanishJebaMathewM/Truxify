import pytest
import torch
from fastapi import HTTPException
from transformers.model import TimeSeriesTransformer
from routes.transformer_routes import (
    ForecastRequest,
    _validate_horizon,
)

class TestTimeSeriesTransformer:
    def test_transformer_init(self):
        model = TimeSeriesTransformer(seq_len=60, pred_len=12, d_model=64)
        assert model is not None
        assert hasattr(model, 'forward')


class TestHorizonValidation:
    def test_matching_horizon_passes(self):
        _validate_horizon(ForecastRequest(data=[[1.0]], horizon=24), 24)

    def test_mismatched_horizon_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            _validate_horizon(ForecastRequest(data=[[1.0]], horizon=48), 24)
        assert exc_info.value.status_code == 422
