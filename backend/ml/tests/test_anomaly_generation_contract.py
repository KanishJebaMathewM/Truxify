"""Native Keras/scikit-learn/Redis/ASGI evidence for paired anomaly generations."""

import json
import shutil
import subprocess
import tempfile
import threading
from collections import deque
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest
import redis
from anomaly.detector import AnomalyDetector
from anomaly.generation_contract import (
    AdmissionError,
    admit_training,
    capture,
    prepare_candidate,
)
from anomaly.models import LSTMAutoencoder
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sklearn.preprocessing import StandardScaler
from tensorflow import keras


@pytest.fixture(autouse=True)
def native_seed():
    keras.utils.set_random_seed(61)
    yield
    keras.backend.clear_session()


def observations(offset=0):
    return np.linspace(-2, 3, 12).reshape(2, 3, 2) + offset


@pytest.fixture
def store(tmp_path):
    executable = (
        shutil.which("redis-server") or "/private/tmp/redis-7.2.5/src/redis-server"
    )
    socket_dir = tempfile.mkdtemp(prefix="ae-")
    socket_path = socket_dir + "/redis.sock"
    process = subprocess.Popen(
        [
            executable,
            "--port",
            "0",
            "--unixsocket",
            socket_path,
            "--save",
            "",
            "--appendonly",
            "no",
        ],
        stdout=subprocess.DEVNULL,
    )
    client = redis.Redis(unix_socket_path=socket_path)
    import time

    for _ in range(100):
        try:
            client.ping()
            break
        except redis.ConnectionError:
            time.sleep(0.02)
    else:
        process.terminate()
        raise RuntimeError("private Redis did not start")
    yield client
    client.close()
    process.terminate()
    process.wait(timeout=5)
    shutil.rmtree(socket_dir)


@pytest.fixture
def detector(tmp_path, monkeypatch, store):
    monkeypatch.chdir(tmp_path)
    service = AnomalyDetector.__new__(AnomalyDetector)
    service.redis = store
    service._generation_lock = threading.RLock()
    service._training_lock = threading.RLock()
    service._generations = {"driver_behavior": 4}
    model = LSTMAutoencoder(2, 3, 2)
    model.build_model()
    scaler = StandardScaler().fit(observations().reshape(-1, 2))
    # Actual native learning and calibrated baseline, not a neural mock.
    scaled = (
        scaler.transform(observations().reshape(-1, 2))
        .reshape(2, 3, 2)
        .astype("float32")
    )
    model.model.train_on_batch(scaled, scaled)
    errors = np.mean(
        np.square(model.model(scaled, training=False).numpy() - scaled), axis=(1, 2)
    )
    model.threshold = float(np.percentile(errors, 95))
    service.models = {"driver_behavior": model}
    service.scalers = {"driver_behavior": scaler}
    service._feature_buffers = {
        ("driver_behavior", "driver"): deque([scaled[0, 0].copy()], maxlen=3)
    }
    service.anomaly_history = deque(maxlen=1000)
    service.alert_thresholds = {"low": 1.5, "medium": 2.0, "high": 3.0}
    return service


def state(service):
    return (
        service.models.copy(),
        service.scalers.copy(),
        service._generations.copy(),
        {k: [v.copy() for v in q] for k, q in service._feature_buffers.items()},
        {
            k: [v.numpy().copy() for v in m.model.weights + m.model.optimizer.variables]
            for k, m in service.models.items()
        },
    )


def unchanged(service, before):
    models, scalers, generations, buffers, native = before
    assert service.models == models and service.scalers == scalers
    assert service._generations == generations
    assert service._feature_buffers.keys() == buffers.keys()
    for key, values in buffers.items():
        np.testing.assert_array_equal(
            np.array(service._feature_buffers[key]), np.array(values)
        )
    for name, values in native.items():
        for current, old in zip(
            service.models[name].model.weights
            + service.models[name].model.optimizer.variables,
            values,
        ):
            np.testing.assert_array_equal(current.numpy(), old)


@pytest.mark.parametrize(
    "invalid",
    [
        None,
        {},
        {"unknown": observations()},
        {"driver_behavior": np.ones((2, 4, 2))},
        {"driver_behavior": np.ones((2, 3))},
        {"driver_behavior": np.ones((129, 3, 2))},
        {"driver_behavior": np.ones((0, 3, 2))},
        {"driver_behavior": np.full((2, 3, 2), np.nan)},
        {"driver_behavior": np.full((2, 3, 2), np.inf)},
        {"driver_behavior": np.ones((2, 3, 2), dtype=bool)},
        {"driver_behavior": [["1"]]},
        {"driver_behavior": np.ones((2, 3, 2), dtype=complex)},
    ],
)
def test_full_data_admission_preserves_native_generation(detector, invalid):
    before = state(detector)
    with pytest.raises(AdmissionError):
        detector.train_models(invalid)
    unchanged(detector, before)


@pytest.mark.parametrize("epochs", [0, 17, True, 1.5, "1"])
def test_work_admission(detector, epochs):
    before = state(detector)
    with pytest.raises(AdmissionError):
        detector.train_models({"driver_behavior": observations()}, epochs)
    unchanged(detector, before)


def test_owned_data_and_independent_population_scaling_calibration(detector):
    raw = observations(100)
    owned = admit_training({"driver_behavior": raw}, detector.models, 1)[
        "driver_behavior"
    ]
    raw[:] = 999
    candidate, scaler, result = prepare_candidate(
        capture(detector.models["driver_behavior"]), owned, 1
    )
    flat = owned.reshape(-1, 2)
    mean = np.sum(flat, axis=0) / len(flat)
    variance = np.sum((flat - mean) ** 2, axis=0) / len(flat)
    expected = ((flat - mean) / np.sqrt(variance)).reshape(2, 3, 2).astype("float32")
    np.testing.assert_allclose(scaler.mean_, mean)
    np.testing.assert_allclose(scaler.var_, variance)
    native = candidate.model(expected, training=False).numpy()
    errors = np.sum((native.astype("float64") - expected) ** 2, axis=(1, 2)) / 6
    np.testing.assert_allclose(
        candidate.threshold, np.percentile(errors, 95), rtol=1e-6
    )
    # Continuation retains old iteration 1 and accepts one private Adam step.
    assert int(candidate.model.optimizer.iterations.numpy()) == 2
    assert result["val_loss"] is None and np.isfinite(result["loss"])
    np.testing.assert_allclose(
        candidate.decoder(candidate.encoder(expected, training=False), training=False),
        native,
    )


def test_success_publishes_new_pair_and_resets_only_affected_windows(detector):
    before = state(detector)
    detector._feature_buffers[("other", "driver")] = deque([np.array([7.0])])
    result = detector.train_models({"driver_behavior": observations(100)})
    assert detector.models["driver_behavior"] is not before[0]["driver_behavior"]
    assert detector.scalers["driver_behavior"] is not before[1]["driver_behavior"]
    assert result["driver_behavior"]["generation"] == 5
    assert ("driver_behavior", "driver") not in detector._feature_buffers
    assert ("other", "driver") in detector._feature_buffers
    assert detector.get_threshold("driver_behavior") > 0
    # Old registered variables remain unchanged even on a successful fit.
    for value, old in zip(
        before[0]["driver_behavior"].model.weights
        + before[0]["driver_behavior"].model.optimizer.variables,
        before[4]["driver_behavior"],
    ):
        np.testing.assert_array_equal(value.numpy(), old)


@pytest.mark.parametrize(
    "stage", ["fit", "calibration", "zero_calibration", "native_weights", "save"]
)
def test_actual_candidate_failure_preserves_all_live_values(
    detector, monkeypatch, stage
):
    before = state(detector)
    original_train, original_save = LSTMAutoencoder.train, LSTMAutoencoder.save
    if stage == "save":

        def fail_save(model, path):
            original_save(model, path)
            raise OSError("disk failure after native HDF5 save")

        monkeypatch.setattr(LSTMAutoencoder, "save", fail_save)
    else:

        def fail_train(model, *args, **kwargs):
            result = original_train(model, *args, **kwargs)
            if stage == "fit":
                raise RuntimeError("failure after actual fit and calibration")
            if stage == "native_weights":
                model.model.weights[0].assign(
                    np.full(model.model.weights[0].shape, np.nan)
                )
            else:
                model.threshold = 0.0 if stage == "zero_calibration" else np.nan
            return result

        monkeypatch.setattr(LSTMAutoencoder, "train", fail_train)
    with pytest.raises((RuntimeError, ValueError, OSError)):
        detector.train_models({"driver_behavior": observations(100)})
    unchanged(detector, before)


def test_multitype_tail_admitted_before_any_candidate(detector, monkeypatch):
    detector.models["transactions"] = detector.models["driver_behavior"]
    before = state(detector)

    def forbid(_):
        raise AssertionError("private allocation before complete admission")

    monkeypatch.setattr(LSTMAutoencoder, "build_model", forbid)
    with pytest.raises(AdmissionError):
        detector.train_models(
            {"driver_behavior": observations(), "transactions": np.ones((2, 4, 2))}
        )
    unchanged(detector, before)


def test_multitype_late_candidate_failure_is_not_partial_publication(
    detector, monkeypatch
):
    detector.models["transactions"] = detector.models["driver_behavior"]
    detector.scalers["transactions"] = detector.scalers["driver_behavior"]
    before = state(detector)
    original = LSTMAutoencoder.train
    calls = []

    def fail_second(model, *args, **kwargs):
        result = original(model, *args, **kwargs)
        calls.append(model)
        if len(calls) == 2:
            raise RuntimeError("second native candidate failed")
        return result

    monkeypatch.setattr(LSTMAutoencoder, "train", fail_second)
    with pytest.raises(RuntimeError):
        detector.train_models(
            {"driver_behavior": observations(100), "transactions": observations(200)}
        )
    assert len(calls) == 2
    unchanged(detector, before)


@pytest.mark.parametrize(
    "raw",
    [np.ones((2, 2)), np.array([1.0, np.nan]), np.ones(3), np.ones(2, dtype=bool)],
)
def test_bad_observation_does_not_change_window(detector, raw):
    before = state(detector)
    assert "error" in detector.detect_anomaly("driver_behavior", raw, "driver")
    unchanged(detector, before)


def test_uncalibrated_and_failed_native_score_do_not_commit_window(
    detector, monkeypatch
):
    model = detector.models["driver_behavior"]
    old = model.threshold
    model.threshold = None
    assert "error" in detector.detect_anomaly("driver_behavior", np.zeros(2), "driver")
    model.threshold = old
    before = state(detector)
    original = model.get_anomaly_score

    def bad_score(window):
        result = original(window)
        result["anomaly_score"] = np.inf
        return result

    monkeypatch.setattr(model, "get_anomaly_score", bad_score)
    assert "error" in detector.detect_anomaly("driver_behavior", np.zeros(2), "driver")
    unchanged(detector, before)


def test_actual_native_window_scoring_and_strict_redis_serialization(detector):
    # A tiny positive calibration guarantees alert storage for ordinary input.
    detector.set_threshold("driver_behavior", 1e-12)
    old = list(detector._feature_buffers[("driver_behavior", "driver")])
    observation = np.array([1.0, 2.0])
    encoded = (
        detector.scalers["driver_behavior"]
        .transform(observation[None])
        .astype("float32")[0]
    )
    window = np.array([old[0], old[0], encoded], dtype="float32")
    reconstructed = (
        detector.models["driver_behavior"]
        .model(window[None], training=False)
        .numpy()[0]
    )
    expected_error = np.mean((reconstructed - window) ** 2)
    result = detector.detect_anomaly("driver_behavior", observation, "driver")
    np.testing.assert_allclose(
        result["reconstruction_error"], expected_error, rtol=1e-6
    )
    assert type(result["is_anomaly"]) is bool and result["generation"] == 4
    stored = json.loads(detector.redis.get("anomaly:latest:driver_behavior"))
    assert stored == result and result["is_anomaly"]
    assert len(detector._feature_buffers[("driver_behavior", "driver")]) == 2


def test_old_generation_serves_during_private_native_fit(detector, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    original = LSTMAutoencoder.train

    def blocked(model, *args, **kwargs):
        entered.set()
        assert release.wait(30)
        return original(model, *args, **kwargs)

    monkeypatch.setattr(LSTMAutoencoder, "train", blocked)
    prior_model = detector.models["driver_behavior"]
    with ThreadPoolExecutor(2) as pool:
        fitting = pool.submit(
            detector.train_models, {"driver_behavior": observations(100)}
        )
        assert entered.wait(30)
        try:
            result = pool.submit(
                detector.detect_anomaly, "driver_behavior", np.zeros(2), "driver"
            ).result(timeout=10)
            assert (
                result["generation"] == 4
                and detector.models["driver_behavior"] is prior_model
            )
        finally:
            release.set()
        assert fitting.result(timeout=30)["driver_behavior"]["generation"] == 5
    assert ("driver_behavior", "driver") not in detector._feature_buffers


def test_publication_waits_for_native_scoring_generation(detector, monkeypatch):
    saved, publish, entered, release = (threading.Event() for _ in range(4))
    old = detector.models["driver_behavior"]
    original_score, original_save = old.get_anomaly_score, LSTMAutoencoder.save

    def pause_save(model, path):
        original_save(model, path)
        saved.set()
        assert publish.wait(30)

    def blocked(window):
        entered.set()
        assert release.wait(30)
        return original_score(window)

    monkeypatch.setattr(old, "get_anomaly_score", blocked)
    monkeypatch.setattr(LSTMAutoencoder, "save", pause_save)
    with ThreadPoolExecutor(2) as pool:
        fitting = pool.submit(
            detector.train_models, {"driver_behavior": observations(100)}
        )
        assert saved.wait(30)
        scoring = pool.submit(
            detector.detect_anomaly, "driver_behavior", np.zeros(2), "driver"
        )
        assert entered.wait(30)
        try:
            publish.set()
            assert not fitting.done() and detector.models["driver_behavior"] is old
        finally:
            release.set()
        assert scoring.result(timeout=30)["generation"] == 4
        assert fitting.result(timeout=30)["driver_behavior"]["generation"] == 5
    assert ("driver_behavior", "driver") not in detector._feature_buffers


def test_actual_mounted_three_dimensional_training_and_admission(detector, monkeypatch):
    from routes import anomaly_routes

    monkeypatch.setattr(anomaly_routes, "detector", detector)
    app = FastAPI()
    app.include_router(anomaly_routes.router)
    client = TestClient(app)
    valid = {"data": {"driver_behavior": observations(100).tolist()}, "epochs": 1}
    response = client.post("/anomaly/train", json=valid)
    assert (
        response.status_code == 200
        and response.json()["data"]["driver_behavior"]["generation"] == 5
    )
    for invalid in [
        dict(valid, epochs=True),
        dict(valid, epochs=17),
        {"data": {"driver_behavior": [[1.0, 2.0]]}},
        {"data": {"unknown": observations().tolist()}},
        {"data": {"driver_behavior": np.ones((2, 4, 2)).tolist()}},
    ]:
        assert client.post("/anomaly/train", json=invalid).status_code == 422
    assert (
        client.post(
            "/anomaly/threshold/set?data_type=driver_behavior&threshold=0"
        ).status_code
        == 422
    )
    assert (
        client.get("/anomaly/threshold/driver_behavior").json()["data"]["threshold"] > 0
    )
    import inspect

    for handler in [
        anomaly_routes.train_models,
        anomaly_routes.detect_driver_anomaly,
        anomaly_routes.detect_transaction_anomaly,
        anomaly_routes.detect_gps_anomaly,
        anomaly_routes.set_threshold,
        anomaly_routes.get_anomaly_history,
        anomaly_routes.get_anomaly_stats,
    ]:
        assert not inspect.iscoroutinefunction(handler)


def test_native_candidate_starts_from_exact_prior_adam_and_weights(
    detector, monkeypatch
):
    prior = capture(detector.models["driver_behavior"])
    original = LSTMAutoencoder.train
    seen = []

    def check_then_train(candidate, *args, **kwargs):
        for actual, expected in zip(candidate.model.get_weights(), prior[3]):
            np.testing.assert_array_equal(actual, expected)
        for actual, expected in zip(candidate.model.optimizer.variables, prior[5]):
            np.testing.assert_array_equal(actual.numpy(), expected)
        seen.append(candidate)
        return original(candidate, *args, **kwargs)

    monkeypatch.setattr(LSTMAutoencoder, "train", check_then_train)
    detector.train_models({"driver_behavior": observations(100)})
    assert len(seen) == 1 and int(seen[0].model.optimizer.iterations.numpy()) == 2


def test_failed_native_fit_returns_internal_error_without_publication(
    detector, monkeypatch
):
    from routes import anomaly_routes

    monkeypatch.setattr(anomaly_routes, "detector", detector)
    app = FastAPI()
    app.include_router(anomaly_routes.router)
    original = LSTMAutoencoder.train

    def actual_failure(candidate, *args, **kwargs):
        original(candidate, *args, **kwargs)
        raise RuntimeError("native post-fit failure")

    monkeypatch.setattr(LSTMAutoencoder, "train", actual_failure)
    before = state(detector)
    response = TestClient(app).post(
        "/anomaly/train", json={"data": {"driver_behavior": observations().tolist()}}
    )
    assert (
        response.status_code == 500
        and response.json()["detail"] == "Internal server error"
    )
    unchanged(detector, before)


def test_native_training_worker_does_not_block_asgi_loop(detector, monkeypatch):
    import asyncio

    import httpx
    from routes import anomaly_routes

    monkeypatch.setattr(anomaly_routes, "detector", detector)
    app = FastAPI()
    app.include_router(anomaly_routes.router)
    entered, release = threading.Event(), threading.Event()
    original = LSTMAutoencoder.train
    worker_ids = []

    def blocked(candidate, *args, **kwargs):
        worker_ids.append(threading.get_ident())
        entered.set()
        assert release.wait(30)
        return original(candidate, *args, **kwargs)

    monkeypatch.setattr(LSTMAutoencoder, "train", blocked)

    async def check():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            fitting = asyncio.create_task(
                client.post(
                    "/anomaly/train",
                    json={"data": {"driver_behavior": observations().tolist()}},
                )
            )
            assert await asyncio.to_thread(entered.wait, 30)
            try:
                response = await asyncio.wait_for(client.get("/anomaly/stats"), 2)
                assert (
                    response.status_code == 200
                    and worker_ids[0] != threading.get_ident()
                )
            finally:
                release.set()
            assert (await asyncio.wait_for(fitting, 30)).status_code == 200

    asyncio.run(check())
