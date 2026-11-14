"""Native learned TensorFlow/scaler/Redis evidence for reporting ownership."""

import asyncio
import json
import shutil
import subprocess
import tempfile
import threading
import time
from collections import OrderedDict, deque
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import httpx
import numpy as np
import pytest
import redis
from anomaly import detector as module
from anomaly.models import LSTMAutoencoder
from fastapi import FastAPI
from sklearn.preprocessing import StandardScaler
from tensorflow import keras


@pytest.fixture(autouse=True)
def native_seed():
    keras.utils.set_random_seed(61)
    yield
    keras.backend.clear_session()


@pytest.fixture
def store():
    executable = (
        shutil.which("redis-server") or "/private/tmp/redis-7.2.5/src/redis-server"
    )
    directory = tempfile.mkdtemp(prefix="alert-")
    socket = str(Path(directory) / "redis.sock")
    process = subprocess.Popen(
        [
            executable,
            "--port",
            "0",
            "--unixsocket",
            socket,
            "--save",
            "",
            "--appendonly",
            "no",
        ],
        stdout=subprocess.DEVNULL,
    )
    client = redis.Redis(unix_socket_path=socket, socket_timeout=5)
    for _ in range(100):
        try:
            client.ping()
            break
        except redis.ConnectionError:
            time.sleep(0.02)
    else:
        process.terminate()
        raise RuntimeError("private Redis did not start")
    yield SimpleNamespace(client=client, process=process, socket=socket)
    client.close()
    if process.poll() is None:
        process.terminate()
    process.wait(5)
    shutil.rmtree(directory)


def native_service(store, kind="driver_behavior", features=2):
    service = module.AnomalyDetector.__new__(module.AnomalyDetector)
    service.redis = store.client
    service._generation_lock = threading.RLock()
    service._training_lock = threading.RLock()
    service._delivery_lock = threading.RLock()
    service._observation_sequence = 0
    service._pending_delivery = deque()
    service._generations = {kind: 4}
    model = LSTMAutoencoder(features, 3, 2)
    model.build_model()
    raw = np.linspace(-2, 3, 2 * 3 * features).reshape(2, 3, features)
    scaler = StandardScaler().fit(raw.reshape(-1, features))
    scaled = (
        scaler.transform(raw.reshape(-1, features))
        .reshape(2, 3, features)
        .astype("float32")
    )
    model.model.train_on_batch(scaled, scaled)
    reconstruction = model.model(scaled, training=False).numpy()
    errors = np.mean(np.square(reconstruction - scaled), axis=(1, 2))
    model.threshold = float(np.percentile(errors, 95))
    assert model.threshold > 0  # Actual native calibration; no neural mock.
    service.models = {kind: model}
    service.scalers = {kind: scaler}
    service._max_feature_buffers = 4096
    service._feature_buffers = OrderedDict()
    service.anomaly_history = deque(maxlen=1000)
    service.alert_thresholds = {"low": 1.5, "medium": 2.0, "high": 3.0}
    # Warm actual TensorFlow prediction before concurrency barriers.
    model.get_anomaly_score(scaled[0])
    return service


@pytest.fixture
def service(store):
    return native_service(store)


def detect(service, value=100.0):
    return service.detect_anomaly(
        "driver_behavior", np.array([[value, value]]), "driver"
    )


def test_actual_return_history_stats_and_redis_records_are_independent(service, store):
    result = detect(service)
    assert result["alert_delivery"] == "published" and result["is_anomaly"]
    prior = service.get_anomaly_history()
    for view in (
        result,
        service.get_anomaly_history()[0],
        service.get_stats()["last_anomaly"],
    ):
        view["severity"] = "FORGED"
        view["data"][0][0] = -999
        view["sequence"] = 99
    assert service.get_anomaly_history() == prior
    cached = json.loads(store.client.get("anomaly:latest:driver_behavior"))
    assert cached == prior[0]
    assert cached["entity_key"] == "driver" and cached["sequence"] == 1
    assert service.get_stats()["by_severity"] == {"CRITICAL": 1}


def test_real_redis_failure_does_not_hide_committed_native_observation(service, store):
    store.process.terminate()
    store.process.wait(5)
    report = detect(service)
    assert "error" not in report
    assert report["is_anomaly"] and report["alert_delivery"] == "unavailable"
    assert report["sequence"] == 1 and report["generation"] == 4
    assert len(service.get_anomaly_history()) == 1
    assert len(service._feature_buffers[("driver_behavior", "driver")]) == 1


def test_paused_native_redis_leaves_history_threshold_and_nonalert_serving_prompt(
    service, store
):
    store.client.execute_command("CLIENT", "PAUSE", 30000, "WRITE")
    with ThreadPoolExecutor(max_workers=3) as pool:
        alert = pool.submit(detect, service)
        try:
            for _ in range(200):
                if len(service.anomaly_history) == 1:
                    break
                time.sleep(0.01)
            assert len(service.anomaly_history) == 1 and not alert.done()
            assert len(pool.submit(service.get_anomaly_history).result(0.5)) == 1
            pool.submit(service.set_threshold, "driver_behavior", 1e30).result(0.5)
            normal = pool.submit(detect, service, 0.0).result(2)
            assert (
                normal["alert_delivery"] == "not_required" and not normal["is_anomaly"]
            )
        finally:
            store.client.execute_command("CLIENT", "UNPAUSE")
        assert alert.result(5)["alert_delivery"] == "published"


@pytest.mark.parametrize("lost_reply", [False, True])
def test_later_native_commit_delivering_first_cannot_be_overwritten(
    service, store, monkeypatch, lost_reply
):
    entered, release = threading.Event(), threading.Event()
    original = service._deliver_alert
    subscriber = store.client.pubsub()
    subscriber.subscribe("anomaly:alerts")
    subscriber.get_message(timeout=1)

    def held(pending):
        if pending[0]["sequence"] == 1:
            entered.set()
            assert release.wait(5)
        return original(pending)

    monkeypatch.setattr(service, "_deliver_alert", held)
    original_setex = store.client.setex

    def write_then_fail(key, ttl, value):
        result = original_setex(key, ttl, value)
        if lost_reply and json.loads(value)["sequence"] == 2:
            raise redis.ConnectionError("reply lost after actual native SETEX")
        return result

    monkeypatch.setattr(store.client, "setex", write_then_fail)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(detect, service, 100.0)
        try:
            assert entered.wait(5)
            second = pool.submit(detect, service, 101.0).result(5)
            assert second["sequence"] == 2
            assert second["alert_delivery"] == (
                "unavailable" if lost_reply else "published"
            )
        finally:
            release.set()
        assert first.result(5)["alert_delivery"] == "published"
    cached = json.loads(store.client.get("anomaly:latest:driver_behavior"))
    assert cached["sequence"] == 2 and cached["data"] == [[101.0, 101.0]]
    expected_events = [1] if lost_reply else [1, 2]
    events = [
        subscriber.get_message(ignore_subscribe_messages=True, timeout=1)
        for _ in expected_events
    ]
    assert [
        json.loads(event["data"])["data"]["sequence"] for event in events
    ] == expected_events
    subscriber.close()
    assert [row["sequence"] for row in service.get_anomaly_history()] == [1, 2]


def test_actual_publish_denial_reports_partial_delivery_honestly(service, store):
    store.client.execute_command(
        "ACL",
        "SETUSER",
        "setex-only",
        "on",
        "nopass",
        "~*",
        "+setex",
        "+ping",
        "-publish",
    )
    restricted = redis.Redis(
        unix_socket_path=store.socket,
        username="setex-only",
        password="",
        socket_timeout=5,
    )
    service.redis = restricted
    try:
        report = detect(service)
        assert report["alert_delivery"] == "unavailable" and "error" not in report
        assert (
            json.loads(store.client.get("anomaly:latest:driver_behavior"))["sequence"]
            == 1
        )
        assert not service._pending_delivery
    finally:
        restricted.close()
        service.redis = store.client
    assert detect(service, 101.0)["alert_delivery"] == "published"


def test_prepared_report_failure_does_not_commit_frame_or_sequence(
    service, store, monkeypatch
):
    def fails(_):
        raise ValueError("owned reporting preparation failed")

    monkeypatch.setattr(module, "deepcopy", fails)
    result = detect(service)
    assert result == {"error": "owned reporting preparation failed"}
    assert service._observation_sequence == 0 and not service._feature_buffers
    assert not service.anomaly_history
    assert store.client.get("anomaly:latest:driver_behavior") is None


def test_actual_mounted_asgi_cancellation_retains_native_delivery_owner(
    store, monkeypatch
):
    from routes import anomaly_routes

    service = native_service(store, "gps_tracking", 4)
    monkeypatch.setattr(anomaly_routes, "detector", service)
    app = FastAPI()
    app.include_router(anomaly_routes.router)
    store.client.execute_command("CLIENT", "PAUSE", 30000, "WRITE")

    async def scenario():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://local"
        ) as client:
            payload = {
                "driver_id": "gps-driver",
                "speed": 100.0,
                "acceleration": 100.0,
                "direction_change": 100.0,
                "route_deviation": 100.0,
            }
            first = asyncio.create_task(
                client.post("/anomaly/detect/gps", json=payload)
            )
            second = None
            try:
                for _ in range(200):
                    if len(service.anomaly_history) == 1:
                        break
                    await asyncio.sleep(0.01)
                assert len(service.anomaly_history) == 1
                first.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await first
                history = await asyncio.wait_for(client.get("/anomaly/history"), 1)
                assert history.status_code == 200 and history.json()["count"] == 1
                acquired = service._delivery_lock.acquire(blocking=False)
                if acquired:
                    service._delivery_lock.release()
                assert not acquired
                second = asyncio.create_task(
                    client.post("/anomaly/detect/gps", json=payload | {"speed": 101.0})
                )
                for _ in range(200):
                    if len(service.anomaly_history) == 2:
                        break
                    await asyncio.sleep(0.01)
                assert len(service.anomaly_history) == 2 and not second.done()
            finally:
                store.client.execute_command("CLIENT", "UNPAUSE")
                await asyncio.gather(
                    first, *([second] if second else []), return_exceptions=True
                )
            assert second is not None and second.result().status_code == 200
            assert second.result().json()["data"]["alert_delivery"] == "published"
            assert (
                json.loads(store.client.get("anomaly:latest:gps_tracking"))["sequence"]
                == 2
            )

    asyncio.run(scenario())


def test_native_reporting_retains_commit_order_across_window_eviction(service, store):
    service._max_feature_buffers = 2
    reports = [service.detect_anomaly(
        "driver_behavior", np.array([[100.0, 100.0]]), entity
    ) for entity in ("a", "b", "c", "b")]
    assert all(r["alert_delivery"] == "published" for r in reports)
    assert [r["sequence"] for r in reports] == [1, 2, 3, 4]
    assert [r["window_observations"] for r in reports] == [1, 1, 1, 2]
    assert list(service._feature_buffers) == [
        ("driver_behavior", "c"), ("driver_behavior", "b")
    ]
    assert [r["entity_key"] for r in service.get_anomaly_history()] == ["a", "b", "c", "b"]
    cached = json.loads(store.client.get("anomaly:latest:driver_behavior"))
    assert cached["sequence"] == 4 and cached["window_observations"] == 2
