"""Serving behavior under controlled native-thread lifecycle interleavings."""
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Event

import numpy as np
import pytest
from app.models import driver_profit as module

ARGS = (500.0, 105.0, 1200.0, 5.0, 8000.0, 10.0)


class Estimator:
    """Small fitted-estimator double, with separately observable inference calls."""

    def __init__(self, value=5000.0, callback=None):
        self.value = value
        self.callback = callback
        self.point_calls = 0
        self.stage_calls = 0

    def predict(self, features):
        self.point_calls += 1
        if self.callback:
            self.callback()
        return np.full(len(features), self.value)

    def staged_predict(self, features):
        self.stage_calls += 1
        return iter([np.full(len(features), self.value - 100), np.full(len(features), self.value)])


def ranges():
    return {name: dict(bounds) for name, bounds in module.TRAINING_FEATURE_RANGES.items()}


def metadata(bounds=None):
    return {"training_meta": {"feature_ranges": ranges() if bounds is None else bounds}}


def install_training(monkeypatch, *, entered=None, release=None, failure=None):
    candidates = []

    class Candidate(Estimator):
        def __init__(self, **kwargs):
            super().__init__(7000.0)
            self.fitted = False
            candidates.append(self)

        def fit(self, features, targets):
            if entered:
                entered.set()
                assert release.wait(5), "test did not release fit"
            if failure:
                raise failure
            self.fitted = True
            return self

        def predict(self, features):
            if not self.fitted:
                raise RuntimeError("unfinished estimator was served")
            return super().predict(features)

    monkeypatch.setattr(module, "GradientBoostingRegressor", Candidate)
    monkeypatch.setattr(module, "_generate_synthetic_data", lambda: (
        np.arange(180, dtype=float).reshape(30, 6), np.arange(30, dtype=float)))
    monkeypatch.setattr(module, "save_model", lambda *args, **kwargs: None)
    return candidates


def install_load(monkeypatch, model, bounds=None):
    monkeypatch.setattr(module, "model_exists", lambda name: True)
    monkeypatch.setattr(module, "load_model", lambda name: model)
    monkeypatch.setattr(module, "get_model_meta", lambda name: metadata(bounds))


def warm_predictor():
    predictor = module.DriverProfitPredictor()
    old = Estimator()
    predictor.model = old
    return predictor, old


def test_successful_cold_training_is_singleflight(monkeypatch):
    entered, release = Event(), Event()
    candidates = install_training(monkeypatch, entered=entered, release=release)
    monkeypatch.setattr(module, "model_exists", lambda name: False)
    predictor = module.DriverProfitPredictor()
    with ThreadPoolExecutor(2) as pool:
        first = pool.submit(predictor.predict, *ARGS)
        try:
            assert entered.wait(3)
            second = pool.submit(predictor.predict, *ARGS)
            with pytest.raises(TimeoutError):
                second.result(.1)
        finally:
            release.set()
        assert first.result(3) == second.result(3)
    assert len(candidates) == 1
    assert candidates[0].fitted


def test_successful_cold_load_is_singleflight(monkeypatch):
    entered, release = Event(), Event()
    calls = []
    loaded = Estimator()
    install_load(monkeypatch, loaded)

    def load(name):
        calls.append(name)
        entered.set()
        assert release.wait(5)
        return loaded

    monkeypatch.setattr(module, "load_model", load)
    predictor = module.DriverProfitPredictor()
    with ThreadPoolExecutor(2) as pool:
        first = pool.submit(predictor.predict, *ARGS)
        try:
            assert entered.wait(3)
            second = pool.submit(predictor.predict, *ARGS)
            with pytest.raises(TimeoutError):
                second.result(.1)
        finally:
            release.set()
        assert first.result(3) == second.result(3)
    assert calls == [module.MODEL_NAME]


@pytest.mark.parametrize("phase", ["fit", "save"])
def test_warm_inference_proceeds_during_private_training(monkeypatch, phase):
    entered, release = Event(), Event()
    predictor, old = warm_predictor()
    candidates = install_training(monkeypatch, entered=entered if phase == "fit" else None,
                                  release=release)
    if phase == "save":
        def save(*args, **kwargs):
            entered.set()
            assert release.wait(5)
        monkeypatch.setattr(module, "save_model", save)
    with ThreadPoolExecutor(2) as pool:
        training = pool.submit(predictor.train)
        try:
            assert entered.wait(3)
            response = pool.submit(predictor.predict, *ARGS).result(1)
            assert response["predicted_profit"] == old.value
            assert predictor.model is old
        finally:
            release.set()
        training.result(3)
    assert predictor.model is candidates[0]
    assert predictor.predict(*ARGS)["predicted_profit"] == 7000


@pytest.mark.parametrize("phase", ["fit", "save"])
@pytest.mark.parametrize("warm", [False, True])
def test_failed_training_preserves_state_and_can_retry(monkeypatch, phase, warm):
    predictor, old = warm_predictor() if warm else (module.DriverProfitPredictor(), None)
    old_ranges = predictor.feature_ranges
    install_training(monkeypatch, failure=RuntimeError("fit failed") if phase == "fit" else None)
    if phase == "save":
        def fail_save(*args, **kwargs):
            raise RuntimeError("save failed")
        monkeypatch.setattr(module, "save_model", fail_save)
    with pytest.raises(RuntimeError, match="failed"):
        predictor.train()
    assert predictor.model is old
    assert predictor.feature_ranges is old_ranges
    install_training(monkeypatch)
    predictor.train()
    assert predictor.predict(*ARGS)["predicted_profit"] == 7000


def test_point_and_stage_calls_keep_one_captured_estimator(monkeypatch):
    predictor, old = warm_predictor()
    successor = Estimator(9000)
    install_load(monkeypatch, successor)
    old.callback = predictor.load
    response = predictor.predict(*ARGS)
    assert response["predicted_profit"] == 5000
    assert old.stage_calls == 1
    assert successor.stage_calls == 0
    assert predictor.model is successor


def test_validation_uses_the_captured_domain(monkeypatch):
    predictor, old = warm_predictor()
    successor_ranges = ranges()
    successor_ranges['route_distance'] = {'min': 1000.0, 'max': 2000.0}
    install_load(monkeypatch, Estimator(9000), successor_ranges)
    validate = predictor._validate_feature_domain

    def switch_and_validate(values, *captured):
        predictor.load()
        return validate(values, *captured)

    monkeypatch.setattr(predictor, '_validate_feature_domain', switch_and_validate)
    assert predictor.predict(*ARGS)["predicted_profit"] == old.value
    monkeypatch.setattr(predictor, '_validate_feature_domain', validate)
    with pytest.raises(ValueError, match='route_distance'):
        predictor.predict(*ARGS)


@pytest.mark.parametrize('bad_bound', ['invalid', float('nan'), float('inf'), 3000.0])
def test_invalid_loaded_ranges_do_not_replace_warm_state(monkeypatch, bad_bound):
    predictor, old = warm_predictor()
    original_ranges = predictor.feature_ranges
    bounds = ranges()
    bounds['route_distance']['min'] = bad_bound
    install_load(monkeypatch, Estimator(9000), bounds)
    with pytest.raises(ValueError):
        predictor.load()
    assert predictor.model is old
    assert predictor.feature_ranges is original_ranges
    assert predictor.predict(*ARGS)['predicted_profit'] == 5000


def test_warm_inference_does_not_wait_on_loaded_metadata(monkeypatch):
    entered, release = Event(), Event()
    predictor, old = warm_predictor()
    loaded = Estimator(9000)

    class DelayedBound:
        def __float__(self):
            entered.set()
            assert release.wait(5)
            return 50.0

    bounds = ranges()
    bounds['route_distance']['min'] = DelayedBound()
    install_load(monkeypatch, loaded, bounds)
    with ThreadPoolExecutor(2) as pool:
        loading = pool.submit(predictor.load)
        try:
            assert entered.wait(3)
            response = pool.submit(predictor.predict, *ARGS).result(1)
            assert response['predicted_profit'] == old.value
        finally:
            release.set()
        loading.result(3)
    assert predictor.model is loaded


def test_load_serializes_after_training(monkeypatch):
    entered, release = Event(), Event()
    predictor, _ = warm_predictor()
    install_training(monkeypatch, entered=entered, release=release)
    loaded = Estimator(9000)
    install_load(monkeypatch, loaded)
    with ThreadPoolExecutor(2) as pool:
        training = pool.submit(predictor.train)
        try:
            assert entered.wait(3)
            loading = pool.submit(predictor.load)
            with pytest.raises(TimeoutError):
                loading.result(.1)
        finally:
            release.set()
        training.result(3)
        loading.result(3)
    assert predictor.model is loaded


@pytest.mark.parametrize('missing', ['artifact', 'metadata'])
def test_legacy_missing_state_still_trains(monkeypatch, missing):
    candidates = install_training(monkeypatch)
    install_load(monkeypatch, None if missing == 'artifact' else Estimator())
    if missing == 'metadata':
        monkeypatch.setattr(module, 'get_model_meta', lambda name: {})
    predictor = module.DriverProfitPredictor()
    assert predictor.predict(*ARGS)['predicted_profit'] == 7000
    assert len(candidates) == 1


@pytest.mark.parametrize('value', [49.0, 2001.0, float('nan'), float('inf')])
def test_domain_validation_remains_enforced(value):
    predictor, model = warm_predictor()
    with pytest.raises(ValueError, match='route_distance'):
        predictor.predict(value, *ARGS[1:])
    assert model.point_calls == model.stage_calls == 0


def test_default_ranges_are_not_shared_between_predictors():
    first = module.DriverProfitPredictor()
    second = module.DriverProfitPredictor()
    original = module.TRAINING_FEATURE_RANGES['route_distance']['min']
    try:
        first.feature_ranges['route_distance']['min'] = 999
        assert second.feature_ranges['route_distance']['min'] == 50
        assert module.TRAINING_FEATURE_RANGES['route_distance']['min'] == 50
    finally:
        module.TRAINING_FEATURE_RANGES['route_distance']['min'] = original


def test_real_regressor_training_persists_candidate_before_publication(monkeypatch):
    predictor, old = warm_predictor()
    observations = []
    original_generate = module._generate_synthetic_data
    monkeypatch.setattr(module, '_generate_synthetic_data', lambda: original_generate(60))

    def save(candidate, name, metrics, training_meta):
        assert predictor.model is old
        assert hasattr(candidate, 'estimators_')
        observations.append((candidate, name, metrics, training_meta))

    monkeypatch.setattr(module, 'save_model', save)
    metrics = predictor.train()
    assert predictor.model is observations[0][0]
    assert observations[0][1] == module.MODEL_NAME
    assert observations[0][2] == metrics
    assert observations[0][3]['feature_ranges'] == ranges()
    assert metrics['n_samples'] == 60
    assert np.isfinite(predictor.predict(*ARGS)['predicted_profit'])
