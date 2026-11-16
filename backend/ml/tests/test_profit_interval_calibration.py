"""Independent rank, signed native estimator and generation admission controls."""
from copy import deepcopy

import numpy as np
import pytest
from app.models import base
from app.models import driver_profit as dp
from app.models.profit_interval import calibrate, interval, validate
from sklearn.ensemble import GradientBoostingRegressor

ARGS = (500.0, 105.0, 1200.0, 5.0, 8000.0, 10.0)


@pytest.mark.parametrize("size", [19, 20, 39, 40, 400, 401])
def test_rank_matches_sorted_independent_order_statistic(size):
    targets = np.random.RandomState(size).normal(size=size)
    predictions = np.linspace(-4, 3, size)
    result = calibrate(targets, predictions)
    expected_rank = -(-(size + 1) * 19 // 20)
    residuals = sorted(abs(float(a) - float(b)) for a, b in zip(targets, predictions))
    assert result["rank"] == expected_rank
    assert result["radius"] == residuals[expected_rank - 1]


def test_exhaustive_exchangeable_rank_coverage():
    # All positions of a held-out observation in a fixed 21-value sample.
    covered = 0
    for held_out in range(21):
        sample = [value for value in range(21) if value != held_out]
        certificate = calibrate(sample, np.zeros(20))
        bounds = interval(0, certificate, ())['confidence_interval']
        covered += bounds['lower'] <= held_out <= bounds['upper']
    assert covered == 20


@pytest.mark.parametrize("count", [1, 2, 18])
def test_insufficient_window_has_no_finite_coverage_claim(count):
    assert calibrate(np.ones(count), np.zeros(count)) is None


@pytest.mark.parametrize("values", [[True, 1], [float('nan'), 1], [float('inf'), 1], ['1', 1]])
def test_invalid_complete_calibration_window(values):
    with pytest.raises(ValueError):
        calibrate(values, [0, 0])


@pytest.mark.parametrize("point", [-100000.0, -1.0, 0.0, 1.0, 100000.0])
def test_signed_calibrated_and_legacy_intervals_contain_point(point):
    for calibration in (None, calibrate(np.arange(20), np.zeros(20))):
        result = interval(point, calibration, [np.array([point - 10]), np.array([point])])
        assert result['confidence_interval']['lower'] <= point <= result['confidence_interval']['upper']
        assert result['interval_calibration']['coverage'] == (None if calibration is None else .95)


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(base, 'MODEL_STORAGE_DIR', str(tmp_path / 'models'))
    monkeypatch.setattr(base, 'MODEL_ARTIFACT_SIGNATURE_DIR', str(tmp_path / 'signatures'))
    monkeypatch.setenv('MODEL_ARTIFACT_HMAC_KEY', 'local-profit-calibration-only')


def fitted(value):
    x = np.arange(120).reshape(20, 6)
    return GradientBoostingRegressor(n_estimators=2, random_state=42).fit(x, np.full(20, value))


def ranges():
    return deepcopy(dp.TRAINING_FEATURE_RANGES)


def test_real_negative_model_preserves_calibration_across_signed_file_roundtrip(store):
    model = fitted(-2000)
    calibration = calibrate(np.arange(20) - 2000, np.full(20, -2000))
    base.save_model(model, dp.MODEL_NAME, training_meta={
        'feature_ranges': ranges(), 'interval_calibration': calibration})
    predictor = dp.DriverProfitPredictor()
    predictor.load()
    result = predictor.predict(*ARGS)
    assert result['predicted_profit'] == -2000
    assert result['confidence_interval'] == {'lower': -2019, 'upper': -1981}
    assert result['interval_calibration'] == calibration


def test_inference_keeps_captured_model_calibration_pair():
    predictor = dp.DriverProfitPredictor()
    old, successor = fitted(-2000), fitted(9000)
    old_calibration = calibrate(np.arange(20), np.zeros(20))
    new_calibration = calibrate(np.arange(20) * 10, np.zeros(20))
    original = old.predict
    def predict(features):
        predictor._publish(successor, ranges(), new_calibration)
        return original(features)
    old.predict = predict
    predictor._publish(old, ranges(), old_calibration)
    result = predictor.predict(*ARGS)
    assert result['predicted_profit'] == -2000
    assert result['interval_calibration']['radius'] == 19
    assert predictor.predict(*ARGS)['interval_calibration']['radius'] == 190


@pytest.mark.parametrize('mutation', [{'radius': float('nan')}, {'radius': -1},
                                     {'rank': 1}, {'sample_count': True},
                                     {'method': 'unknown'}, {'data_provenance': 'real'}])
def test_invalid_metadata_cannot_replace_warm_generation(store, mutation):
    predictor = dp.DriverProfitPredictor()
    model = fitted(-2000)
    predictor._publish(model, ranges())
    calibration = calibrate(np.arange(20), np.zeros(20)) | mutation
    base.save_model(fitted(9000), dp.MODEL_NAME, training_meta={
        'feature_ranges': ranges(), 'interval_calibration': calibration})
    with pytest.raises(ValueError):
        predictor.load()
    assert predictor.model is model
    assert predictor.predict(*ARGS)['interval_calibration']['coverage'] is None


def test_metadata_is_owned_and_endpoint_arithmetic_is_checked():
    original = calibrate(np.arange(20), np.zeros(20))
    owned = validate(original)
    original['radius'] = 999
    assert owned['radius'] == 19
    with pytest.raises(ValueError):
        interval(1.7e308, owned | {'radius': 1.7e308}, ())
    with pytest.raises(ValueError):
        calibrate([-1.7e308], [1.7e308])


def test_real_training_publishes_heldout_certificate(store):
    predictor = dp.DriverProfitPredictor()
    predictor.train()
    meta = base.load_model_snapshot(dp.MODEL_NAME).metadata['training_meta']
    assert meta['interval_calibration']['sample_count'] == 400
    assert meta['interval_calibration']['rank'] == 381
    loaded = dp.DriverProfitPredictor()
    loaded.load()
    assert loaded.predict(*ARGS) == predictor.predict(*ARGS)


def test_training_fit_calibration_and_evaluation_are_disjoint(store, monkeypatch):
    windows = []
    original_fit, original_predict = GradientBoostingRegressor.fit, GradientBoostingRegressor.predict
    def fit(self, features, targets, **kwargs):
        windows.append(('fit', {tuple(row) for row in features}))
        return original_fit(self, features, targets, **kwargs)
    def predict(self, features):
        windows.append(('predict', {tuple(row) for row in features}))
        return original_predict(self, features)
    monkeypatch.setattr(GradientBoostingRegressor, 'fit', fit)
    monkeypatch.setattr(GradientBoostingRegressor, 'predict', predict)
    dp.DriverProfitPredictor().train()
    fitting, calibration, evaluation = (window for _, window in windows)
    assert (len(fitting), len(calibration), len(evaluation)) == (1200, 400, 400)
    assert not (fitting & calibration or fitting & evaluation or calibration & evaluation)


def test_failed_candidate_publication_retains_calibrated_serving_pair(store, monkeypatch):
    predictor = dp.DriverProfitPredictor()
    old = fitted(-2000)
    old_calibration = calibrate(np.arange(20), np.zeros(20))
    predictor._publish(old, ranges(), old_calibration)
    def fail(*args, **kwargs):
        raise OSError('controlled rejected publication')
    monkeypatch.setattr(dp, 'save_model', fail)
    with pytest.raises(OSError):
        predictor.train()
    assert predictor.model is old
    assert predictor.predict(*ARGS)['interval_calibration'] == old_calibration


def test_actual_response_schema_preserves_calibration_provenance():
    # Compile the actual schema declaration without starting unrelated ML engines.
    import ast
    from pathlib import Path

    from pydantic import BaseModel
    source = Path(__file__).parents[1] / 'main.py'
    declaration = next(node for node in ast.parse(source.read_text()).body
                       if isinstance(node, ast.ClassDef) and node.name == 'DriverProfitOutput')
    scope = {'BaseModel': BaseModel}
    exec(compile(ast.Module(body=[declaration], type_ignores=[]), str(source), 'exec'), scope)  # noqa: S102 - actual local schema declaration only
    result = interval(-2000, calibrate(np.arange(20), np.zeros(20)), ())
    assert scope['DriverProfitOutput'](**result).model_dump() == result
