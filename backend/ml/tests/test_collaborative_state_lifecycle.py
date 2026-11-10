"""Actual recommender state publication under controlled threaded interleavings."""
import importlib
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Barrier, Event

import numpy as np
import pytest

cf = importlib.import_module('app.models.collaborative_filter')


def payload(prefix='old', reverse_users=False):
    return {
        'user_load_approx': np.array([[5., 1.], [1., 5.]]),
        'user_truck_approx': np.array([[5., 1.], [1., 5.]]),
        'user_load_matrix': np.array([[5., 1.], [1., 5.]]),
        'user_truck_matrix': np.array([[5., 1.], [1., 5.]]),
        'user_ids': ['v', 'u'] if reverse_users else ['u', 'v'],
        'load_ids': [prefix + '-load0', prefix + '-load1'],
        'truck_ids': [prefix + '-truck0', prefix + '-truck1'],
        'popular_loads': np.array([0, 1]),
        'popular_trucks': np.array([0, 1]),
    }


def serve(model, kind='load', user='u', history=None):
    method = model.recommend_loads if kind == 'load' else model.recommend_trucks
    return method(user, history or [], 1)['recommendations'][0][kind + '_id']


@pytest.fixture
def loaded(monkeypatch):
    monkeypatch.setattr(cf, 'model_exists', lambda name: True)
    monkeypatch.setattr(cf, 'load_model', lambda name: payload())
    model = cf.CollaborativeFilter()
    model.load()
    return model


@pytest.mark.parametrize('kind', ['load', 'truck'])
def test_cold_recommendation_waits_for_complete_publication(monkeypatch, kind):
    entered, release = Event(), Event()

    class PausedPayload(dict):
        def __getitem__(self, key):
            if key == 'user_truck_approx':
                entered.set()
                assert release.wait(2)
            return super().__getitem__(key)

    monkeypatch.setattr(cf, 'model_exists', lambda name: True)
    monkeypatch.setattr(cf, 'load_model', lambda name: PausedPayload(payload()))
    model = cf.CollaborativeFilter()
    with ThreadPoolExecutor(2) as pool:
        loader = pool.submit(model.load)
        try:
            assert entered.wait(1)
            recommendation = pool.submit(serve, model, kind)
            with pytest.raises(TimeoutError):
                recommendation.result(timeout=.05)
        finally:
            release.set()
        loader.result(timeout=2)
        assert recommendation.result(timeout=2) == 'old-' + kind + '0'


@pytest.mark.parametrize('kind', ['load', 'truck'])
def test_scoring_uses_captured_user_row_after_refresh(monkeypatch, loaded, kind):
    entered, release = Event(), Event()
    original = loaded._recommend

    def paused(*args, **kwargs):
        entered.set()
        assert release.wait(2)
        return original(*args, **kwargs)

    monkeypatch.setattr(loaded, '_recommend', paused)
    with ThreadPoolExecutor(1) as pool:
        request = pool.submit(serve, loaded, kind)
        try:
            assert entered.wait(1)
            monkeypatch.setattr(cf, 'load_model', lambda name: payload('new', reverse_users=True))
            loaded.load()
        finally:
            release.set()
        assert request.result(timeout=2) == 'old-' + kind + '0'
    assert serve(loaded, kind) == 'new-' + kind + '1'


@pytest.mark.parametrize('auto_train', [False, True])
def test_cold_callers_share_initialization(monkeypatch, auto_train):
    entered, release, duplicate = Event(), Event(), Event()
    start = Barrier(6)
    calls = []
    data = payload()

    def prepare(*args):
        calls.append(1)
        if len(calls) > 1:
            duplicate.set()
        entered.set()
        assert release.wait(2)
        return data

    monkeypatch.setattr(cf, 'model_exists', lambda name: not auto_train)
    if auto_train:
        monkeypatch.setattr(cf, '_generate_synthetic_data', prepare)
        monkeypatch.setattr(cf, 'save_model', lambda *args: None)
    else:
        monkeypatch.setattr(cf, 'load_model', prepare)
    model = cf.CollaborativeFilter()

    def caller():
        start.wait(timeout=2)
        return serve(model)

    with ThreadPoolExecutor(6) as pool:
        futures = [pool.submit(caller) for _ in range(6)]
        try:
            assert entered.wait(1)
            assert not duplicate.wait(.1)
        finally:
            release.set()
        assert [f.result(timeout=2) for f in futures] == ['old-load0'] * 6
    assert len(calls) == 1


@pytest.mark.parametrize('kind', ['load', 'truck'])
def test_warm_scoring_continues_while_training_waits_to_persist(monkeypatch, loaded, kind):
    entered, release = Event(), Event()
    monkeypatch.setattr(cf, '_generate_synthetic_data', lambda: payload('new', reverse_users=True))

    def persist(*args):
        entered.set()
        assert release.wait(2)

    monkeypatch.setattr(cf, 'save_model', persist)
    with ThreadPoolExecutor(2) as pool:
        training = pool.submit(loaded.train)
        try:
            assert entered.wait(1)
            assert pool.submit(serve, loaded, kind).result(timeout=1) == 'old-' + kind + '0'
        finally:
            release.set()
        training.result(timeout=2)
    assert serve(loaded, kind) == 'new-' + kind + '1'


@pytest.mark.parametrize('failure_stage', ['svd', 'persistence'])
def test_failed_training_preserves_old_serving_state(monkeypatch, loaded, failure_stage):
    monkeypatch.setattr(cf, '_generate_synthetic_data', lambda: payload('new', reverse_users=True))

    def fail(*args):
        raise OSError('training preparation failed')

    monkeypatch.setattr(cf, '_svd_reconstruct' if failure_stage == 'svd' else 'save_model', fail)
    with pytest.raises(OSError, match='preparation failed'):
        loaded.train()
    assert serve(loaded) == 'old-load0'
    assert serve(loaded, 'truck') == 'old-truck0'
    assert loaded.user_ids == ['u', 'v']


def test_incomplete_refresh_preserves_all_previous_fields(monkeypatch, loaded):
    incomplete = payload('new', reverse_users=True)
    del incomplete['popular_trucks']
    monkeypatch.setattr(cf, 'load_model', lambda name: incomplete)
    with pytest.raises(KeyError, match='popular_trucks'):
        loaded.load()
    assert serve(loaded) == 'old-load0'
    assert serve(loaded, 'truck') == 'old-truck0'
    assert loaded.user_ids == ['u', 'v']


def test_failed_cold_load_can_retry(monkeypatch):
    calls = []

    def read(name):
        calls.append(name)
        if len(calls) == 1:
            raise OSError('temporary artifact error')
        return payload()

    monkeypatch.setattr(cf, 'model_exists', lambda name: True)
    monkeypatch.setattr(cf, 'load_model', read)
    model = cf.CollaborativeFilter()
    with pytest.raises(OSError, match='temporary artifact error'):
        serve(model)
    assert serve(model) == 'old-load0'
    assert len(calls) == 2


@pytest.mark.parametrize('kind', ['load', 'truck'])
@pytest.mark.parametrize('user', ['u', 'unknown'])
def test_snapshot_scoring_retains_booking_exclusions(loaded, kind, user):
    assert serve(loaded, kind, user, [{kind + '_id': 'old-' + kind + '0'}]) == 'old-' + kind + '1'
