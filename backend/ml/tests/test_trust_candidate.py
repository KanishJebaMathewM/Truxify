"""Real fitted sklearn and authenticated local artifact admission witnesses."""
import copy
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import numpy as np
import pytest
from app.models import base
from app.models import trust_scorer as module
from app.models.trust_candidate import FEATURES, validate_candidate
from sklearn.ensemble import RandomForestClassifier
from sklearn.exceptions import NotFittedError
from sklearn.preprocessing import StandardScaler

ARGS = (.1, 80., 4., 1, 1)


@pytest.fixture
def artifacts(monkeypatch, tmp_path):
    monkeypatch.setattr(base, "MODEL_STORAGE_DIR", str(tmp_path / "artifacts"))
    monkeypatch.setattr(base, "MODEL_ARTIFACT_SIGNATURE_DIR", str(tmp_path / "signatures"))
    monkeypatch.setenv("MODEL_ARTIFACT_HMAC_KEY", "ephemeral-native-fixture-key")
    return tmp_path


@pytest.fixture
def fitted():
    rng = np.random.RandomState(81)
    x = rng.uniform(size=(60, 5)) * [1, 100, 5, 20, 1]
    scaler = StandardScaler().fit(x)
    model = RandomForestClassifier(n_estimators=5, random_state=7).fit(
        scaler.transform(x), np.arange(60) % 3,
    )
    return model, scaler


def persist(pair):
    base.save_model(pair, module.MODEL_NAME)


def warm(pair):
    persist(pair)
    scorer = module.TrustScorer()
    scorer.load()
    return scorer


def test_authenticated_native_roundtrip_retains_prediction(artifacts, fitted):
    m, s = fitted
    expected = module.RISK_LABELS[int(m.predict(s.transform([ARGS]))[0])]
    scorer = warm(fitted)
    assert scorer.predict(*ARGS) == {"trust_score": 81.88, "risk_category": expected}
    assert isinstance(scorer.model, RandomForestClassifier)
    assert isinstance(scorer.scaler, StandardScaler)


@pytest.mark.parametrize("defect", [
    "unfitted_model", "unfitted_scaler", "wrong_model_features", "wrong_scaler_features",
    "unknown_class", "nonfinite_class", "mean", "variance", "negative_variance",
    "scale", "zero_scale", "shape", "native_tree", "zero_tree", "negative_tree",
    "feature_order", "empty_forest", "threshold",
])
def test_signed_bad_candidate_preserves_working_pair(artifacts, fitted, defect):
    scorer = warm(fitted)
    old = scorer.model, scorer.scaler
    before = scorer.predict(*ARGS)
    m, s = copy.deepcopy(fitted)
    if defect == "unfitted_model":
        m = RandomForestClassifier()
    elif defect == "unfitted_scaler":
        s = StandardScaler()
    elif defect == "wrong_model_features":
        m = RandomForestClassifier(n_estimators=2).fit(np.ones((6, 4)), [0, 1, 2, 0, 1, 2])
    elif defect == "wrong_scaler_features":
        s = StandardScaler().fit(np.ones((6, 4)))
    elif defect == "unknown_class":
        m.classes_[0] = 99
    elif defect == "nonfinite_class":
        m.classes_ = np.array([0., 1., np.nan])
    elif defect == "mean":
        s.mean_[0] = np.nan
    elif defect == "variance":
        s.var_[0] = np.inf
    elif defect == "negative_variance":
        s.var_[0] = -1
    elif defect == "scale":
        s.scale_[0] = np.inf
    elif defect == "zero_scale":
        s.scale_[0] = 0
    elif defect == "shape":
        s.mean_ = s.mean_[:4]
    elif defect == "native_tree":
        m.estimators_[0].tree_.value[:] = np.nan
    elif defect == "zero_tree":
        m.estimators_[0].tree_.value[:] = 0
    elif defect == "negative_tree":
        m.estimators_[0].tree_.value[:] = -1
    elif defect == "feature_order":
        s.feature_names_in_ = np.array(FEATURES[::-1])
    elif defect == "empty_forest":
        m.estimators_ = []
    elif defect == "threshold":
        m.estimators_[0].tree_.threshold[0] = np.nan
    persist((m, s))  # Actual authentication succeeds; candidate semantics reject.
    with pytest.raises((ValueError, TypeError, NotFittedError)):
        scorer.load()
    assert (scorer.model, scorer.scaler) == old
    assert scorer.predict(*ARGS) == before


def test_invalid_cold_artifact_does_not_publish_or_retrain(artifacts, monkeypatch):
    persist((RandomForestClassifier(), StandardScaler()))
    scorer = module.TrustScorer()
    monkeypatch.setattr(scorer, "train", lambda: pytest.fail("invalid present artifact retrained"))
    with pytest.raises(NotFittedError):
        scorer.predict(*ARGS)
    assert scorer.model is None and scorer.scaler is None


def test_bad_native_probabilities_never_manufacture_low_risk(artifacts, fitted):
    scorer = warm(fitted)
    for estimator in scorer.model.estimators_:
        estimator.tree_.value[:] = np.nan
    assert np.isnan(scorer.model.predict_proba(scorer.scaler.transform([ARGS]))).all()
    with pytest.raises(ValueError, match="probabilities"):
        scorer.predict(*ARGS)


def test_unknown_native_label_cannot_be_reported_medium(artifacts, fitted):
    scorer = warm(fitted)
    scorer.model.classes_[:] = 99
    with pytest.raises(ValueError, match="unsupported"):
        scorer.predict(*ARGS)


def test_warm_native_reads_continue_during_candidate_validation(artifacts, fitted, monkeypatch):
    scorer = warm(fitted)
    before = scorer.predict(*ARGS)
    entered, release = Event(), Event()
    def paused(m, s):
        entered.set()
        assert release.wait(10)
        validate_candidate(m, s)
    monkeypatch.setattr(module, "validate_candidate", paused)
    with ThreadPoolExecutor(2) as pool:
        loading = pool.submit(scorer.load)
        try:
            assert entered.wait(10)
            assert pool.submit(scorer.predict, *ARGS).result(2) == before
        finally:
            release.set()
        loading.result(10)


def test_native_successful_cold_load_coalesces(artifacts, fitted, monkeypatch):
    persist(fitted)
    scorer = module.TrustScorer()
    entered, release = Event(), Event()
    calls = []
    original = module.load_model
    def paused(name):
        calls.append(name)
        entered.set()
        assert release.wait(10)
        return original(name)
    monkeypatch.setattr(module, "load_model", paused)
    with ThreadPoolExecutor(2) as pool:
        first = pool.submit(scorer.predict, *ARGS)
        assert entered.wait(10)
        second = pool.submit(scorer.predict, *ARGS)
        release.set()
        assert first.result(10) == second.result(10)
    assert calls == [module.MODEL_NAME]


def test_invalid_native_training_cannot_persist_or_publish(artifacts, fitted, monkeypatch):
    scorer = warm(fitted)
    before = scorer.predict(*ARGS)
    previous_artifact = base.load_model(module.MODEL_NAME)[0].predict(
        scorer.scaler.transform([ARGS]),
    ).tolist()
    class BadCandidate(RandomForestClassifier):
        def fit(self, x, y):
            super().fit(x, y)
            self.classes_[0] = 99
            return self
    monkeypatch.setattr(module, "RandomForestClassifier", BadCandidate)
    with pytest.raises(ValueError, match="unsupported"):
        scorer.train()
    assert scorer.predict(*ARGS) == before
    assert base.load_model(module.MODEL_NAME)[0].predict(
        scorer.scaler.transform([ARGS]),
    ).tolist() == previous_artifact


def test_single_supported_class_and_constant_feature_scaler_are_valid():
    x = np.ones((9, 5))
    s = StandardScaler().fit(x)
    m = RandomForestClassifier(n_estimators=2).fit(s.transform(x), [2] * 9)
    validate_candidate(m, s)
    scorer = module.TrustScorer()
    scorer.model, scorer.scaler = m, s
    assert scorer.predict(*ARGS)["risk_category"] == "High"


def test_named_native_feature_schema_roundtrip(artifacts):
    import pandas as pd
    frame = pd.DataFrame(np.arange(60).reshape(12, 5), columns=FEATURES)
    s = StandardScaler().fit(frame)
    scaled = pd.DataFrame(s.transform(frame), columns=FEATURES)
    m = RandomForestClassifier(n_estimators=3, random_state=3).fit(scaled, np.arange(12) % 3)
    scorer = warm((m, s))
    input_frame = pd.DataFrame([ARGS], columns=FEATURES)
    expected = m.predict(pd.DataFrame(s.transform(input_frame), columns=FEATURES))[0]
    assert scorer.predict(*ARGS)["risk_category"] == module.RISK_LABELS[int(expected)]


def test_native_pair_remains_captured_across_mid_transform_load(artifacts, monkeypatch):
    x = np.arange(45).reshape(9, 5)
    s = StandardScaler().fit(x)
    low = RandomForestClassifier(n_estimators=2).fit(s.transform(x), [0] * 9)
    high = RandomForestClassifier(n_estimators=2).fit(s.transform(x), [2] * 9)
    scorer = warm((low, s))
    persist((high, s))
    transform = scorer.scaler.transform
    def loading_transform(values):
        result = transform(values)
        scorer.load()
        return result
    monkeypatch.setattr(scorer.scaler, "transform", loading_transform)
    assert scorer.predict(*ARGS)["risk_category"] == "Low"
    assert scorer.predict(*ARGS)["risk_category"] == "High"
