"""Real file publication interleavings at mounted prediction consumers."""

import threading

import numpy as np
import pytest
from app.models import base
from app.models import driver_profit as dp
from app.models import price_prediction as pp
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.preprocessing import StandardScaler


@pytest.fixture(autouse=True)
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(base, "MODEL_STORAGE_DIR", str(tmp_path / "models"))
    monkeypatch.setattr(
        base, "MODEL_ARTIFACT_SIGNATURE_DIR", str(tmp_path / "signatures")
    )
    monkeypatch.setenv("MODEL_ARTIFACT_HMAC_KEY", "local-consumer-test-only")
    monkeypatch.setattr(pp, "_get_weather_multiplier", lambda city: 1.0)


def fitted(value, features):
    x = np.array([np.arange(features) + i for i in range(20)])
    scaler = StandardScaler().fit(x)
    model = GradientBoostingRegressor(n_estimators=2).fit(
        scaler.transform(x), np.full(20, value)
    )
    return model, scaler


def publish_after_first_metadata_read(monkeypatch, publish):
    original = base._read_candidate_meta
    fired = []

    def read(*args):
        meta = original(*args)
        if not fired:
            fired.append(True)
            failures = []

            def writer():
                try:
                    publish()
                except BaseException as exc:  # noqa: BLE001 - propagate native writer failures
                    failures.append(exc)

            thread = threading.Thread(target=writer)
            thread.start()
            thread.join(2)
            assert not thread.is_alive(), "immutable read must not block publication"
            assert not failures
        return meta

    monkeypatch.setattr(base, "_read_candidate_meta", read)
    return fired


def test_price_real_flag_matches_admitted_artifact_during_publication(monkeypatch):
    model, scaler = fitted(1000, 10)
    newer, newer_scaler = fitted(9000, 10)
    base.save_model((model, scaler, {}), pp.MODEL_NAME, {"is_real_model": True})
    fired = publish_after_first_metadata_read(
        monkeypatch,
        lambda: base.save_model(
            (newer, newer_scaler, {}), pp.MODEL_NAME, {"is_real_model": False}
        ),
    )
    result = pp.predict_price(800, 9000)
    assert fired
    assert result["estimated_price"] == 1000
    # Subsequent admission sees the newer ineligible generation.
    assert pp.predict_price(800, 9000) is None


def test_profit_feature_domain_matches_loaded_artifact_during_publication(monkeypatch):
    older, _ = fitted(1000, 6)
    newer, _ = fitted(9000, 6)
    old_ranges = {name: {"min": 0, "max": 10} for name in dp.FEATURE_NAMES}
    new_ranges = {name: {"min": 0, "max": 50} for name in dp.FEATURE_NAMES}
    base.save_model(older, dp.MODEL_NAME, training_meta={"feature_ranges": old_ranges})
    fired = publish_after_first_metadata_read(
        monkeypatch,
        lambda: base.save_model(
            newer, dp.MODEL_NAME, training_meta={"feature_ranges": new_ranges}
        ),
    )
    predictor = dp.DriverProfitPredictor()
    predictor.load()
    assert fired
    assert predictor.model.predict(np.zeros((1, 6)))[0] == 1000
    assert predictor.feature_ranges == old_ranges
    newer_predictor = dp.DriverProfitPredictor()
    newer_predictor.load()
    assert newer_predictor.feature_ranges == new_ranges
    assert newer_predictor.model.predict(np.zeros((1, 6)))[0] == 9000


@pytest.mark.parametrize("metrics", [{}, {"is_real_model": False}])
def test_price_ineligible_metadata_stays_unavailable(metrics):
    model, scaler = fitted(1000, 10)
    base.save_model((model, scaler, {}), pp.MODEL_NAME, metrics)
    assert pp.predict_price(800, 9000) is None


def test_price_no_artifact_stays_unavailable():
    assert pp.predict_price(800, 9000) is None


@pytest.mark.parametrize("exists", [True, False])
def test_profit_missing_metadata_or_model_retains_retraining(monkeypatch, exists):
    if exists:
        model, _ = fitted(1000, 6)
        base.save_model(model, dp.MODEL_NAME)
    predictor = dp.DriverProfitPredictor()
    calls = []
    monkeypatch.setattr(predictor, "train", lambda: calls.append(True))
    predictor.load()
    assert calls == [True]
