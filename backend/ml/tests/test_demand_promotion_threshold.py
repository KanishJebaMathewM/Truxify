import math

import pytest

from app.models import demand_forecast


@pytest.mark.parametrize('raw', ['nan', 'NaN', 'inf', '+Infinity', '-inf', '-0.01', 'invalid', ''])
def test_invalid_threshold_uses_finite_default(monkeypatch, raw):
    monkeypatch.setenv('PROMOTION_MAE_IMPROVEMENT_THRESHOLD', raw)
    threshold = demand_forecast._load_promotion_mae_improvement_threshold()
    assert math.isfinite(threshold)
    assert threshold == demand_forecast.DEFAULT_PROMOTION_MAE_IMPROVEMENT_THRESHOLD
    # A material improvement must still pass the gate after bad configuration.
    assert (100.0 - 90.0) / 100.0 >= threshold


@pytest.mark.parametrize('raw, expected', [('0', 0.0), ('0.05', 0.05), (' 0.1 ', 0.1), ('1.5', 1.5)])
def test_finite_nonnegative_threshold_is_preserved(monkeypatch, raw, expected):
    monkeypatch.setenv('PROMOTION_MAE_IMPROVEMENT_THRESHOLD', raw)
    assert demand_forecast._load_promotion_mae_improvement_threshold() == expected


def test_missing_threshold_uses_default(monkeypatch):
    monkeypatch.delenv('PROMOTION_MAE_IMPROVEMENT_THRESHOLD', raising=False)
    assert demand_forecast._load_promotion_mae_improvement_threshold() == 0.01


def test_nan_configuration_does_not_block_better_model_publication(monkeypatch, tmp_path):
    from app.models import base

    monkeypatch.setattr(base, 'MODEL_STORAGE_DIR', str(tmp_path))
    monkeypatch.setenv('PROMOTION_MAE_IMPROVEMENT_THRESHOLD', 'nan')
    monkeypatch.setattr(
        demand_forecast, 'PROMOTION_MAE_IMPROVEMENT_THRESHOLD',
        demand_forecast._load_promotion_mae_improvement_threshold(),
    )
    base.save_model(('old', 'scaler'), demand_forecast.MODEL_NAME, metrics={'mae': 100.0})
    metrics = demand_forecast.train_demand_forecast_model()
    assert metrics['promoted'] is True
    assert metrics['mae'] < 99.0
    assert base.load_model(demand_forecast.MODEL_NAME) != ('old', 'scaler')
