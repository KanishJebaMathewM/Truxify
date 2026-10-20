"""Actual signed artifacts and competing native writers at demand decisions."""
import math
from fractions import Fraction
from threading import Event, Thread

import numpy as np
import pytest
from app.models import base
from app.models import demand_forecast as demand
from app.models.demand_promotion import meets_threshold
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.preprocessing import StandardScaler

FEATURES = [12, 3, 0, 25., .5, 50, 15]


@pytest.fixture(autouse=True)
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(base, 'MODEL_STORAGE_DIR', str(tmp_path / 'models'))
    monkeypatch.setattr(base, 'MODEL_ARTIFACT_SIGNATURE_DIR', str(tmp_path / 'signatures'))
    monkeypatch.setenv('MODEL_ARTIFACT_HMAC_KEY', 'local-demand-decision-only')
    demand.reset_model_cache()
    yield
    demand.reset_model_cache()


def model(value):
    x = np.arange(140).reshape(20, 7)
    scaler = StandardScaler().fit(x)
    estimator = GradientBoostingRegressor(n_estimators=2, random_state=42).fit(
        scaler.transform(x), np.full(20, value))
    return estimator, scaler


def publish(value, mae, source='real_bookings'):
    base.save_model(model(value), demand.MODEL_NAME, {'mae': mae},
                    training_meta={'source': source})
    return base.get_active_generation(demand.MODEL_NAME)


@pytest.mark.parametrize('old_source,new_source,allowed', [
    ('synthetic', 'real_bookings', False), ('real_bookings', 'synthetic', True),
    ('module_trained', 'synthetic', True)])
def test_provenance_belongs_to_actual_admitted_artifact(monkeypatch, old_source, new_source, allowed):
    publish(1000, 10, old_source)
    original = base._read_candidate_meta
    fired, errors = [], []
    def read(*args):
        result = original(*args)
        if not fired:
            fired.append(True)
            def writer():
                try:
                    publish(9000, 1, new_source)
                except BaseException as exc:  # noqa: BLE001 - propagate native writer failure
                    errors.append(exc)
            thread = Thread(target=writer)
            thread.start()
            thread.join(3)
            assert not thread.is_alive()
            assert not errors
        return result
    monkeypatch.setattr(base, '_read_candidate_meta', read)
    if allowed:
        assert demand.predict_demand(FEATURES) == 1000
    else:
        with pytest.raises(RuntimeError, match='synthetic'):
            demand.predict_demand(FEATURES)
    assert fired


def small_training(monkeypatch):
    generate = demand.generate_synthetic_demand_data
    monkeypatch.setattr(demand, 'generate_synthetic_demand_data', lambda: generate(100))


def test_competing_writer_cannot_enter_between_admission_and_save(monkeypatch):
    small_training(monkeypatch)
    publish(1000, 1e6)
    admitted, contender_started, completed = Event(), Event(), Event()
    errors = []
    original = demand.get_model_meta
    calls = []
    def metadata(name):
        result = original(name)
        if not calls:
            calls.append(True)
            admitted.set()
            assert contender_started.wait(3)
            assert not completed.wait(.1), 'newer native writer replaced admitted generation before save'
        return result
    monkeypatch.setattr(demand, 'get_model_meta', metadata)
    def writer():
        try:
            assert admitted.wait(3)
            contender_started.set()
            publish(9000, 0)
        except BaseException as exc:  # noqa: BLE001 - propagate controlled thread failure
            errors.append(exc)
        finally:
            completed.set()
    thread = Thread(target=writer)
    thread.start()
    try:
        result = demand.train_demand_forecast_model()
    finally:
        thread.join(4)
    assert not thread.is_alive() and not errors
    assert result['promoted']
    assert base.get_model_meta(demand.MODEL_NAME)['metrics']['mae'] == 0
    assert base.get_active_generation(demand.MODEL_NAME) != result['production_version']
    assert demand.predict_demand(FEATURES) == 9000


def test_newer_better_generation_before_admission_is_retained(monkeypatch):
    small_training(monkeypatch)
    publish(1000, 1e6)
    original = demand.GradientBoostingRegressor.fit
    fired = []
    def fit(self, *args, **kwargs):
        result = original(self, *args, **kwargs)
        if not fired:
            fired.append(True)
            publish(9000, 0)
        return result
    monkeypatch.setattr(demand.GradientBoostingRegressor, 'fit', fit)
    result = demand.train_demand_forecast_model()
    assert not result['promoted']
    assert result['production_version'] == base.get_active_generation(demand.MODEL_NAME)
    assert demand.predict_demand(FEATURES) == 9000


@pytest.mark.parametrize('metric', [-1, float('nan'), float('inf'), True, '10'])
def test_invalid_stored_mae_cannot_authorize_publication(monkeypatch, metric):
    small_training(monkeypatch)
    generation = publish(1000, metric)
    with pytest.raises(ValueError):
        demand.train_demand_forecast_model()
    assert base.get_active_generation(demand.MODEL_NAME) == generation
    assert demand.predict_demand(FEATURES) == 1000


@pytest.mark.parametrize('candidate', [0., 1., 9.9, 1e-300, 1e300])
@pytest.mark.parametrize('current', [0., 1., 10., 1e-300, 1e300])
def test_threshold_matches_independent_exact_cross_product(current, candidate):
    threshold = .01
    expected = current != 0 and ((Fraction(current)-Fraction(candidate))*Fraction(1)
                                >= Fraction(current)*Fraction(threshold))
    assert meets_threshold(current, candidate, threshold) is expected


def test_adjacent_binary_values_at_threshold_are_not_rounded_into_acceptance():
    # Find independently whether each representable neighbour qualifies.
    for candidate in [math.nextafter(.99, 0), .99, math.nextafter(.99, math.inf)]:
        expected = 1 - Fraction(candidate) >= Fraction(.01)
        assert meets_threshold(1., candidate, .01) is expected


def test_failed_save_keeps_existing_generation_and_warm_cache(monkeypatch):
    small_training(monkeypatch)
    generation = publish(1000, 1e6)
    assert demand.predict_demand(FEATURES) == 1000
    captured = demand._model_cache
    def fail(*args, **kwargs):
        raise OSError('controlled publication rejection')
    monkeypatch.setattr(demand, 'save_model', fail)
    with pytest.raises(OSError):
        demand.train_demand_forecast_model()
    assert base.get_active_generation(demand.MODEL_NAME) == generation
    assert demand._model_cache is captured


def test_rollback_report_cannot_mix_with_competing_successor(monkeypatch):
    old = publish(1000, 10)
    publish(9000, 1)
    admitted, contender_started, completed = Event(), Event(), Event()
    original = demand.restore_previous_model
    errors = []
    def restore(name):
        result = original(name)
        admitted.set()
        assert contender_started.wait(3)
        assert not completed.wait(.1), 'report observed another writer after restore'
        return result
    monkeypatch.setattr(demand, 'restore_previous_model', restore)
    def writer():
        try:
            assert admitted.wait(3)
            contender_started.set()
            publish(5000, 0)
        except BaseException as exc:  # noqa: BLE001 - native errors must fail the test
            errors.append(exc)
        finally:
            completed.set()
    thread = Thread(target=writer)
    thread.start()
    try:
        result = demand.rollback_demand_forecast_model()
    finally:
        thread.join(4)
    assert not thread.is_alive() and not errors
    assert result['rolled_back']
    assert result['production_version'] == old
    assert result['metrics']['mae'] == 10
    assert demand.predict_demand(FEATURES) == 5000


@pytest.mark.parametrize('current,candidate,threshold,expected', [
    (0., 0., 0., True), (0., 1., 0., False), (0., 0., .01, False),
    (1., 1., 0., True), (1., 2., 0., False)])
def test_zero_threshold_and_perfect_metric_policy(current, candidate, threshold, expected):
    assert meets_threshold(current, candidate, threshold) is expected


def test_cancelled_native_candidate_does_not_replace_or_reset_cache(monkeypatch):
    from app import execution
    small_training(monkeypatch)
    generation = publish(1000, 1e6)
    assert demand.predict_demand(FEATURES) == 1000
    captured = demand._model_cache
    original = demand.GradientBoostingRegressor.fit
    def fit(self, *args, **kwargs):
        result = original(self, *args, **kwargs)
        monkeypatch.setattr(execution, 'is_training_cancelled', lambda: True)
        return result
    monkeypatch.setattr(demand.GradientBoostingRegressor, 'fit', fit)
    with pytest.raises(execution.TrainingCancelled):
        demand.train_demand_forecast_model()
    assert base.get_active_generation(demand.MODEL_NAME) == generation
    assert demand._model_cache is captured
