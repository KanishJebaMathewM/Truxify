"""Process-local cache ownership tests using real demand code and worker threads."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event
from types import SimpleNamespace

import pytest
from app.models import demand_forecast as demand

FEATURES = [12, 3, 0, 25., .5, 50, 15]


class IdentityScaler:
    def transform(self, values):
        return values


def model_tuple(value):
    return SimpleNamespace(predict=lambda values: [value]), IdentityScaler()


@pytest.fixture(autouse=True)
def clean_cache(monkeypatch):
    demand.reset_model_cache()
    monkeypatch.setattr(demand, 'model_exists', lambda name: True)
    monkeypatch.setattr(demand, 'get_model_meta', lambda name: {})
    yield
    demand.reset_model_cache()


def predict():
    return demand.predict_demand(FEATURES)


@pytest.mark.parametrize('reset_count', [1, 3])
def test_reset_revokes_an_inflight_cold_load(monkeypatch, reset_count):
    entered, release = Event(), Event()
    current = [model_tuple(11.)]
    loads = []

    def load(name):
        captured = current[0]
        loads.append(captured)
        if len(loads) == 1:
            entered.set()
            assert release.wait(2)
        return captured

    monkeypatch.setattr(demand, 'load_model', load)
    with ThreadPoolExecutor(1) as pool:
        future = pool.submit(predict)
        try:
            assert entered.wait(1)
            current[0] = model_tuple(22.)
            for _ in range(reset_count):
                demand.reset_model_cache()
        finally:
            release.set()
        assert future.result(timeout=2) == 22.
    assert predict() == 22.
    assert len(loads) == 2


def test_concurrent_cold_predictions_share_one_load(monkeypatch):
    entered, release = Event(), Event()
    duplicate = Event()
    start = Barrier(8)
    loads = []

    def load(name):
        loads.append(name)
        if len(loads) > 1:
            duplicate.set()
        entered.set()
        assert release.wait(2)
        return model_tuple(30.)

    def caller():
        start.wait(timeout=2)
        return predict()

    monkeypatch.setattr(demand, 'load_model', load)
    with ThreadPoolExecutor(8) as pool:
        futures = [pool.submit(caller) for _ in range(8)]
        try:
            assert entered.wait(1)
            assert not duplicate.wait(.1)
        finally:
            release.set()
        assert [future.result(timeout=2) for future in futures] == [30.] * 8
    assert loads == [demand.MODEL_NAME]


@pytest.mark.parametrize('failure', [None, OSError('storage unavailable')])
def test_failed_cold_load_releases_ownership_for_retry(monkeypatch, failure):
    calls = []

    def load(name):
        calls.append(name)
        if len(calls) == 1:
            if isinstance(failure, Exception):
                raise failure
            return None
        return model_tuple(42.)

    monkeypatch.setattr(demand, 'load_model', load)
    with pytest.raises((RuntimeError, OSError)):
        predict()
    assert predict() == 42.
    assert predict() == 42.
    assert len(calls) == 2


def test_reset_during_warm_inference_keeps_its_stable_tuple(monkeypatch):
    entered, release = Event(), Event()

    class BlockingScaler:
        def transform(self, values):
            entered.set()
            assert release.wait(2)
            return values

    old = model_tuple(11.)
    demand._model_cache = (old[0], BlockingScaler())
    monkeypatch.setattr(demand, 'load_model', lambda name: model_tuple(22.))
    with ThreadPoolExecutor(1) as pool:
        future = pool.submit(predict)
        try:
            assert entered.wait(1)
            demand.reset_model_cache()
            assert predict() == 22.
        finally:
            release.set()
        assert future.result(timeout=2) == 11.
    assert predict() == 22.


def test_warm_predictions_do_not_wait_for_training_lock():
    demand._model_cache = model_tuple(8.)
    with ThreadPoolExecutor(1) as pool, demand._cache_lock:
        assert pool.submit(predict).result(timeout=1) == 8.


@pytest.mark.parametrize('restored', [False, True])
def test_rollback_serializes_with_training_and_only_resets_on_success(monkeypatch, restored):
    called, started = Event(), Event()
    original = model_tuple(5.)
    demand._model_cache = original

    def restore(name):
        called.set()
        return restored

    def rollback():
        started.set()
        return demand.rollback_demand_forecast_model()

    monkeypatch.setattr(demand, 'restore_previous_model', restore)
    monkeypatch.setattr(demand, 'get_active_generation', lambda name: 'current')
    with ThreadPoolExecutor(1) as pool:
        with demand._cache_lock:
            future = pool.submit(rollback)
            assert started.wait(1)
            assert not called.wait(.05)
        result = future.result(timeout=2)
    assert called.is_set()
    assert result['rolled_back'] is restored
    if restored:
        assert demand._model_cache is None
    else:
        assert demand._model_cache is original


def test_failed_rollback_preserves_cache_and_releases_training_lock(monkeypatch):
    original = model_tuple(5.)
    demand._model_cache = original

    def fail(name):
        raise OSError('restore failed')

    monkeypatch.setattr(demand, 'restore_previous_model', fail)
    with pytest.raises(OSError, match='restore failed'):
        demand.rollback_demand_forecast_model()
    assert demand._model_cache is original
    with ThreadPoolExecutor(1) as pool:
        assert pool.submit(lambda: demand._cache_lock.acquire(timeout=1)).result(timeout=2)
        pool.submit(demand._cache_lock.release).result(timeout=2)


def test_missing_artifact_error_does_not_populate_cache(monkeypatch):
    monkeypatch.setattr(demand, 'model_exists', lambda name: False)
    with pytest.raises(RuntimeError, match='artifact missing'):
        predict()
    assert demand._model_cache is None


def test_input_shape_validation_happens_before_loading(monkeypatch):
    monkeypatch.setattr(demand, 'load_model', lambda name: pytest.fail('unexpected load'))
    with pytest.raises(ValueError, match='tensor shape'):
        demand.predict_demand([1.])


def test_second_reset_revokes_replacement_load_too(monkeypatch):
    entered = [Event(), Event()]
    release = [Event(), Event()]
    loads = []

    def load(name):
        index = len(loads)
        loads.append(index)
        if index < 2:
            entered[index].set()
            assert release[index].wait(2)
        return model_tuple(float(index + 1))

    monkeypatch.setattr(demand, 'load_model', load)
    with ThreadPoolExecutor(1) as pool:
        future = pool.submit(predict)
        try:
            for index in range(2):
                assert entered[index].wait(1)
                demand.reset_model_cache()
                release[index].set()
        finally:
            for event in release:
                event.set()
        assert future.result(timeout=2) == 3.
    assert predict() == 3.
    assert loads == [0, 1, 2]


def test_waiting_cold_caller_recovers_after_owner_failure(monkeypatch):
    entered, release = Event(), Event()
    calls = []

    def load(name):
        calls.append(name)
        if len(calls) == 1:
            entered.set()
            assert release.wait(2)
            raise OSError('temporary read error')
        return model_tuple(9.)

    monkeypatch.setattr(demand, 'load_model', load)
    with ThreadPoolExecutor(2) as pool:
        owner = pool.submit(predict)
        try:
            assert entered.wait(1)
            follower = pool.submit(predict)
        finally:
            release.set()
        with pytest.raises(OSError, match='temporary read error'):
            owner.result(timeout=2)
        assert follower.result(timeout=2) == 9.
    assert predict() == 9.
    assert len(calls) == 2
