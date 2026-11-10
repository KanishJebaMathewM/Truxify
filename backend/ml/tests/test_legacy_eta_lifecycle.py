"""Native sklearn serving-generation interleavings with private artifacts."""
import hashlib
import pickle
import threading
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest
from app.models import eta_prediction as module
from sklearn.ensemble import RandomForestRegressor


@pytest.fixture
def predictor(tmp_path, monkeypatch):
    monkeypatch.setattr(module, "MODEL_PATH", str(tmp_path / "eta.pkl"))
    monkeypatch.setattr(module, "MODEL_HASH_PATH", str(tmp_path / "eta.sha256"))
    instance = module.ETAPredictor()
    generate = instance.generate_synthetic_data
    monkeypatch.setattr(instance, "generate_synthetic_data", lambda: generate(80))
    return instance


def fitted(predictor, shift=0):
    x, y = module.ETAPredictor().generate_synthetic_data(80)
    return RandomForestRegressor(n_estimators=3, random_state=42).fit(x, y + shift)


def prediction(predictor, route="highway"):
    return predictor.predict(100, 10, 2, route, 70)


def test_warm_predictions_retain_fitted_generation_during_native_fit(predictor, monkeypatch):
    warm = predictor.model = fitted(predictor)
    expected = prediction(predictor)
    entered, release = threading.Event(), threading.Event()
    native = RandomForestRegressor.fit
    def controlled(model, *args, **kwargs):
        entered.set()
        assert release.wait(10)
        return native(model, *args, **kwargs)
    monkeypatch.setattr(RandomForestRegressor, "fit", controlled)
    with ThreadPoolExecutor(1) as pool:
        task = pool.submit(predictor.train)
        assert entered.wait(5)
        try:
            assert prediction(predictor) == expected
            assert predictor.model is warm
        finally:
            release.set()
        task.result(10)
    assert predictor.model is not warm
    assert np.isfinite(prediction(predictor)["eta_minutes"])


@pytest.mark.parametrize("phase", ["fit", "model_write", "hash_write"])
def test_native_failure_retains_warm_generation(predictor, monkeypatch, tmp_path, phase):
    warm = predictor.model = fitted(predictor)
    expected = prediction(predictor)
    if phase == "fit":
        monkeypatch.setattr(predictor, "generate_synthetic_data", lambda: (np.ones((3, 5)), np.ones(2)))
    else:
        path = tmp_path / "directory"
        path.mkdir()
        monkeypatch.setattr(module, "MODEL_PATH" if phase == "model_write" else "MODEL_HASH_PATH", str(path))
    with pytest.raises((ValueError, IsADirectoryError)):
        predictor.train()
    assert predictor.model is warm
    assert prediction(predictor) == expected


def test_cold_callers_coalesce_one_native_fit(predictor, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    calls = []
    native = RandomForestRegressor.fit
    def controlled(model, *args, **kwargs):
        calls.append(model)
        entered.set()
        assert release.wait(10)
        return native(model, *args, **kwargs)
    monkeypatch.setattr(RandomForestRegressor, "fit", controlled)
    with ThreadPoolExecutor(6) as pool:
        jobs = [pool.submit(prediction, predictor) for _ in range(6)]
        assert entered.wait(5)
        release.set()
        results = [job.result(10) for job in jobs]
    assert len(calls) == 1 and all(result == results[0] for result in results)
    assert predictor._verify_hash()


def test_load_roundtrip_and_failed_read_preserve_serving_state(predictor):
    predictor.train()
    expected = prediction(predictor)
    cold = module.ETAPredictor()
    cold.load()
    assert prediction(cold) == expected
    warm = cold.model
    with open(module.MODEL_PATH, "wb") as stream:
        stream.write(b"not a native pickle")
    with open(module.MODEL_HASH_PATH, "w") as stream:
        stream.write(hashlib.sha256(b"not a native pickle").hexdigest())
    with pytest.raises(pickle.UnpicklingError):
        cold.load()
    assert cold.model is warm
    assert prediction(cold) == expected


def test_prediction_uses_one_captured_native_generation(predictor):
    predictor.model = fitted(predictor)
    expected = prediction(predictor)
    next_model = fitted(predictor, 100)
    entered, release = threading.Event(), threading.Event()
    class PausedRoute(str):
        def strip(self):
            entered.set()
            assert release.wait(10)
            return super().strip()
    with ThreadPoolExecutor(1) as pool:
        task = pool.submit(prediction, predictor, PausedRoute("highway"))
        assert entered.wait(5)
        try:
            with predictor._state_lock:
                predictor.model = next_model
        finally:
            release.set()
        assert task.result(10) == expected
    assert prediction(predictor) != expected


@pytest.mark.parametrize("initial", ["missing", "corrupt"])
@pytest.mark.parametrize("phase", ["hash_read", "pickle_read"])
@pytest.mark.parametrize("warm", [False, True])
def test_fallback_read_failure_never_publishes_prepared_model(
        predictor, monkeypatch, initial, phase, warm):
    from pathlib import Path
    if warm:
        predictor.model = fitted(predictor)
    before = predictor.model
    if initial == "corrupt":
        Path(module.MODEL_PATH).write_bytes(b"old unusable artifact")
    if phase == "hash_read":
        native_save = predictor._save_hash
        def directory_after_write():
            native_save()
            path = Path(module.MODEL_HASH_PATH)
            path.unlink()
            path.mkdir()
        monkeypatch.setattr(predictor, "_save_hash", directory_after_write)
        expected = IsADirectoryError
    else:
        native_verify = predictor._verify_hash
        def unreadable_after_verification():
            valid = native_verify()
            if valid:
                Path(module.MODEL_PATH).write_bytes(b"not a native pickle")
            return valid
        monkeypatch.setattr(predictor, "_verify_hash", unreadable_after_verification)
        expected = pickle.UnpicklingError
    with pytest.raises(expected):
        predictor.load()
    assert predictor.model is before
    if warm:
        assert np.isfinite(prediction(predictor)["eta_minutes"])
