"""Classifier/scaler coherence under controlled serving interleavings."""
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Event

import numpy as np
import pytest
from app.models import trust_scorer as module

ARGS = (.1, 80.0, 4.0, 1, 1)


class Scaler:
    """Tag transformed data so an incompatible classifier cannot accept it."""

    def __init__(self, tag=1, callback=None):
        self.tag, self.callback = tag, callback
        self.fitted = True

    def transform(self, values):
        if not self.fitted:
            raise RuntimeError('unfinished scaler was served')
        if self.callback:
            self.callback()
        return np.full_like(values, self.tag)


class Classifier:
    """Classifier double requiring data from its matching scaler."""

    def __init__(self, tag=1, label=0):
        self.tag, self.label = tag, label
        self.fitted = True

    def predict(self, values):
        if not self.fitted:
            raise RuntimeError('unfinished classifier was served')
        if not np.all(values == self.tag):
            raise RuntimeError('mixed classifier/scaler pair')
        return np.full(len(values), self.label)


def warm():
    scorer = module.TrustScorer()
    scorer.model, scorer.scaler = Classifier(), Scaler()
    return scorer


def install_load(monkeypatch, pair):
    monkeypatch.setattr(module, 'model_exists', lambda name: True)
    monkeypatch.setattr(module, 'load_model', lambda name: pair)


def training(monkeypatch, phase=None, entered=None, release=None, failure=None):
    instances = []

    def boundary(current):
        if current != phase:
            return
        if entered:
            entered.set()
            assert release.wait(5)
        if failure:
            raise RuntimeError(f'{current} failed')

    class CandidateScaler(Scaler):
        def __init__(self):
            super().__init__(2)
            self.fitted = False
            instances.append(self)

        def fit_transform(self, values):
            boundary('scaler')
            self.fitted = True
            return self.transform(values)

    class CandidateClassifier(Classifier):
        def __init__(self, **kwargs):
            super().__init__(2, 2)
            self.fitted = False
            instances.append(self)

        def fit(self, values, labels):
            boundary('classifier')
            self.fitted = True
            return self

    def save(*args, **kwargs):
        boundary('save')

    monkeypatch.setattr(module, 'StandardScaler', CandidateScaler)
    monkeypatch.setattr(module, 'RandomForestClassifier', CandidateClassifier)
    monkeypatch.setattr(module, 'generate_synthetic_trust_data', lambda: (
        np.arange(300, dtype=float).reshape(60, 5), np.arange(60) % 3))
    monkeypatch.setattr(module, 'save_model', save)
    # Thread interleavings concern serving state; real metrics/fit tested below.
    monkeypatch.setattr(module, 'classification_report', lambda *a, **kw: {})
    return instances


def test_reload_between_transform_and_classification_keeps_captured_pair(monkeypatch):
    scorer = warm()
    original = scorer.model
    install_load(monkeypatch, (Classifier(2, 2), Scaler(2)))
    scorer.scaler.callback = scorer.load
    response = scorer.predict(*ARGS)
    assert response == {'trust_score': 81.88, 'risk_category': 'Low'}
    assert scorer.model is not original
    assert scorer.predict(*ARGS)['risk_category'] == 'High'


@pytest.mark.parametrize('phase', ['scaler', 'classifier', 'save'])
def test_warm_inference_completes_during_private_preparation(monkeypatch, phase):
    entered, release = Event(), Event()
    scorer = warm()
    old = scorer.model, scorer.scaler
    training(monkeypatch, phase, entered, release)
    with ThreadPoolExecutor(2) as pool:
        updating = pool.submit(scorer.train)
        try:
            assert entered.wait(3)
            assert pool.submit(scorer.predict, *ARGS).result(1)['risk_category'] == 'Low'
            assert (scorer.model, scorer.scaler) == old
        finally:
            release.set()
        updating.result(3)
    assert scorer.predict(*ARGS)['risk_category'] == 'High'


@pytest.mark.parametrize('cold', [False, True])
@pytest.mark.parametrize('phase', ['scaler', 'classifier', 'save'])
def test_failed_preparation_preserves_pair_and_allows_retry(monkeypatch, phase, cold):
    scorer = module.TrustScorer() if cold else warm()
    old = scorer.model, scorer.scaler
    training(monkeypatch, phase, failure=True)
    with pytest.raises(RuntimeError, match='failed'):
        scorer.train()
    assert (scorer.model, scorer.scaler) == old
    if not cold:
        assert scorer.predict(*ARGS)['risk_category'] == 'Low'
    training(monkeypatch)
    scorer.train()
    assert scorer.predict(*ARGS)['risk_category'] == 'High'


def test_successful_cold_training_is_coalesced(monkeypatch):
    entered, release = Event(), Event()
    instances = training(monkeypatch, 'classifier', entered, release)
    monkeypatch.setattr(module, 'model_exists', lambda name: False)
    scorer = module.TrustScorer()
    with ThreadPoolExecutor(2) as pool:
        first = pool.submit(scorer.predict, *ARGS)
        try:
            assert entered.wait(3)
            second = pool.submit(scorer.predict, *ARGS)
            with pytest.raises(TimeoutError):
                second.result(.1)
        finally:
            release.set()
        assert first.result(3) == second.result(3)
    assert len(instances) == 2  # One scaler and one classifier.


def test_successful_cold_load_is_coalesced(monkeypatch):
    entered, release = Event(), Event()
    pair, reads = (Classifier(), Scaler()), []
    install_load(monkeypatch, pair)

    def read(name):
        reads.append(name)
        entered.set()
        assert release.wait(5)
        return pair

    monkeypatch.setattr(module, 'load_model', read)
    scorer = module.TrustScorer()
    with ThreadPoolExecutor(2) as pool:
        first = pool.submit(scorer.predict, *ARGS)
        try:
            assert entered.wait(3)
            second = pool.submit(scorer.predict, *ARGS)
            with pytest.raises(TimeoutError):
                second.result(.1)
        finally:
            release.set()
        assert first.result(3) == second.result(3)
    assert reads == [module.MODEL_NAME]


@pytest.mark.parametrize('pair', [(None, Scaler()), (Classifier(), None),
                                  (object(), Scaler()), (Classifier(), object()), (Classifier(),)])
def test_incomplete_loaded_pair_does_not_replace_warm_state(monkeypatch, pair):
    scorer = warm()
    old = scorer.model, scorer.scaler
    install_load(monkeypatch, pair)
    with pytest.raises((TypeError, ValueError)):
        scorer.load()
    assert (scorer.model, scorer.scaler) == old
    assert scorer.predict(*ARGS)['risk_category'] == 'Low'


def test_load_failure_keeps_warm_pair(monkeypatch):
    scorer = warm()
    old = scorer.model, scorer.scaler
    install_load(monkeypatch, None)

    def fail_read(name):
        raise RuntimeError('artifact unavailable')

    monkeypatch.setattr(module, 'load_model', fail_read)
    with pytest.raises(RuntimeError, match='artifact unavailable'):
        scorer.load()
    assert (scorer.model, scorer.scaler) == old


def test_warm_inference_completes_while_artifact_read_waits(monkeypatch):
    entered, release = Event(), Event()
    scorer = warm()
    install_load(monkeypatch, None)

    def read(name):
        entered.set()
        assert release.wait(5)
        return Classifier(2, 2), Scaler(2)

    monkeypatch.setattr(module, 'load_model', read)
    with ThreadPoolExecutor(2) as pool:
        updating = pool.submit(scorer.load)
        try:
            assert entered.wait(3)
            assert pool.submit(scorer.predict, *ARGS).result(1)['risk_category'] == 'Low'
        finally:
            release.set()
        updating.result(3)
    assert scorer.predict(*ARGS)['risk_category'] == 'High'


def test_load_serializes_after_training(monkeypatch):
    entered, release = Event(), Event()
    scorer = warm()
    training(monkeypatch, 'classifier', entered, release)
    successor = Classifier(3, 1), Scaler(3)
    install_load(monkeypatch, successor)
    with ThreadPoolExecutor(2) as pool:
        updating = pool.submit(scorer.train)
        try:
            assert entered.wait(3)
            loading = pool.submit(scorer.load)
            with pytest.raises(TimeoutError):
                loading.result(.1)
        finally:
            release.set()
        updating.result(3)
        loading.result(3)
    assert (scorer.model, scorer.scaler) == successor
    assert scorer.predict(*ARGS)['risk_category'] == 'Medium'


@pytest.mark.parametrize('available', [False, True])
def test_missing_artifact_keeps_synthetic_fallback(monkeypatch, available):
    instances = training(monkeypatch)
    install_load(monkeypatch, None)
    monkeypatch.setattr(module, 'model_exists', lambda name: available)
    scorer = module.TrustScorer()
    assert scorer.predict(*ARGS)['risk_category'] == 'High'
    assert len(instances) == 2


def test_real_classifier_scaler_pair_persists_before_publication(monkeypatch):
    scorer = warm()
    old = scorer.model, scorer.scaler
    observations = []
    values = np.arange(90) % 3
    features = np.tile(values[:, None], (1, 5)).astype(float)
    monkeypatch.setattr(module, 'generate_synthetic_trust_data', lambda: (features, values))

    def save(pair, name, metrics):
        assert (scorer.model, scorer.scaler) == old
        assert hasattr(pair[0], 'estimators_') and hasattr(pair[1], 'mean_')
        observations.append((pair, name, metrics))

    monkeypatch.setattr(module, 'save_model', save)
    metrics = scorer.train()
    assert (scorer.model, scorer.scaler) == observations[0][0]
    assert observations[0][1] == module.MODEL_NAME
    assert observations[0][2] == metrics
    assert metrics['n_samples'] == 90 and metrics['accuracy'] == 1.0
    result = scorer.predict(*ARGS)
    assert result['trust_score'] == 81.88
    assert result['risk_category'] in {'Low', 'Medium', 'High'}
