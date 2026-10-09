"""Real TensorFlow/Fernet/Redis evidence for client round participation."""

import json
import os
import shutil
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import numpy as np
import pytest
import redis
import tensorflow as tf
from cryptography.fernet import Fernet
from federated.federated_client import FederatedClient

assert tf.__version__


@pytest.fixture(scope="module")
def native_redis():
    binary = os.environ.get("REDIS_SERVER") or shutil.which("redis-server")
    if not binary:
        pytest.fail("Native redis-server required")
    with tempfile.TemporaryDirectory(dir="/tmp", prefix="fed-") as directory:
        path = directory + "/redis.sock"
        process = subprocess.Popen(
            [
                binary,
                "--port",
                "0",
                "--unixsocket",
                path,
                "--save",
                "",
                "--appendonly",
                "no",
            ],
            stdout=subprocess.DEVNULL,
        )
        client = redis.Redis(unix_socket_path=path)
        try:
            for _ in range(200):
                try:
                    client.ping()
                    break
                except redis.ConnectionError:
                    time.sleep(0.01)
            else:
                pytest.fail("Native Redis did not start")
            yield client, "unix://" + path
        finally:
            client.close()
            process.terminate()
            process.wait(timeout=5)


@pytest.fixture
def client(native_redis, monkeypatch):
    storage, url = native_redis
    storage.flushdb()
    storage.set("federated:encryption_key", Fernet.generate_key())
    monkeypatch.setattr(FederatedClient, "_subscribe_updates", lambda self: None)
    instance = FederatedClient("native-client", url)
    yield instance
    instance.redis.close()


def deliver(client, round_id=1, weights=None, payload=None):
    if payload is None:
        if weights is None:
            weights = [w.tolist() for w in client.model.get_weights()]
        payload = {"round": round_id, "weights": weights}
    token = client.cipher.encrypt(json.dumps(payload).encode())
    client.redis.set("federated:weights:native-client", token)


def equal(actual, expected):
    assert len(actual) == len(expected)
    for a, b in zip(actual, expected):
        np.testing.assert_array_equal(a, b)


def local_data():
    return np.zeros((4, 10), dtype=np.float32), np.zeros(4, dtype=np.float32)


@pytest.mark.parametrize(
    "kind",
    ["empty", "missing", "extra", "shape", "nan", "inf", "overflow", "string", "bool"],
)
def test_invalid_model_preserves_native_accepted_pair(client, kind):
    deliver(client, 4)
    assert client.receive_weights()
    original = client.model.get_weights()
    weights = [w.tolist() for w in original]
    if kind == "empty":
        weights = []
    elif kind == "missing":
        weights = weights[:-1]
    elif kind == "extra":
        weights = weights + [weights[-1]]
    elif kind == "shape":
        weights[0] = [1.0]
    else:
        value = {
            "nan": float("nan"),
            "inf": float("inf"),
            "overflow": 1e100,
            "string": "1",
            "bool": True,
        }[kind]
        weights[0] = np.full(original[0].shape, value).tolist()
    deliver(client, 17, weights)
    assert client.receive_weights() is False
    assert client.training_round == 4
    assert client._accepted_round == 4
    equal(client.model.get_weights(), original)


@pytest.mark.parametrize("tag", [True, 1.0, "1", -1, None])
def test_invalid_round_tag_cannot_replace_native_model(client, tag):
    before = client.model.get_weights()
    deliver(client, tag)
    assert not client.receive_weights()
    assert client._accepted_round is None
    assert client.training_round == 0
    equal(client.model.get_weights(), before)


def test_stale_and_conflicting_same_round_models_do_not_roll_back(client):
    original = client.model.get_weights()
    one = [np.ones_like(w) for w in original]
    two = [np.full_like(w, 2) for w in original]
    deliver(client, 20, [w.tolist() for w in one])
    assert client.receive_weights()
    for tag in (19, 20):
        deliver(client, tag, [w.tolist() for w in two])
        assert not client.receive_weights()
        assert client.training_round == 20
        equal(client.model.get_weights(), one)
    deliver(client, 20, [w.tolist() for w in one])
    assert client.receive_weights()


def test_missing_delivery_never_trains_or_invents_next_round(client):
    before = client.model.get_weights()
    result = client.participate_in_round(*local_data(), epochs=1)
    assert not result["success"]
    assert client.local_data is None
    assert client.training_round == 0
    equal(client.model.get_weights(), before)
    assert client.redis.get("federated:update:native-client") is None
    assert not client.train_local(*local_data(), epochs=1)["success"]
    assert not client.send_update()["success"]


def test_real_training_and_encrypted_publish_are_once_only(client, monkeypatch):
    deliver(client, 3)
    before = client.model.get_weights()
    original_fit = client.model.fit
    calls = []

    def counted(*args, **kwargs):
        calls.append(1)
        return original_fit(*args, **kwargs)

    monkeypatch.setattr(client.model, "fit", counted)
    first = client.participate_in_round(*local_data(), epochs=1)
    assert first["success"] and first["round"] == 3
    token = client.redis.get("federated:update:native-client")
    decoded = json.loads(client.cipher.decrypt(token))
    assert decoded["round"] == 3
    equal(
        [np.asarray(w, dtype=n.dtype) for w, n in zip(decoded["weights"], before)],
        client.model.get_weights(),
    )
    assert any(
        not np.array_equal(a, b) for a, b in zip(before, client.model.get_weights())
    )
    second = client.participate_in_round(*local_data(), epochs=1)
    assert second["success"] and second["update"]["duplicate"]
    assert len(calls) == 1
    assert client.training_round == 3
    assert client.redis.get("federated:update:native-client") == token


def test_failed_notice_retry_preserves_trained_round_without_retraining(
    client, monkeypatch
):
    deliver(client, 7)
    original = client.redis.publish

    def fail_notice(*args, **kwargs):
        raise redis.ConnectionError("injected private notice boundary failure")

    monkeypatch.setattr(client.redis, "publish", fail_notice)
    failed = client.participate_in_round(*local_data(), epochs=1)
    assert failed["success"] is False and failed["update"]["success"] is False
    assert (
        client.training_round == 7
        and client._trained_round == 7
        and client._published_round is None
    )
    trained = client.model.get_weights()
    monkeypatch.setattr(client.redis, "publish", original)
    resumed = client.participate_in_round(*local_data(), epochs=1)
    assert resumed["success"] and resumed["training"]["duplicate"]
    equal(client.model.get_weights(), trained)
    assert client._published_round == 7 and client.training_round == 7


def test_new_delivery_waits_for_actual_training_and_old_round_publication(
    client, monkeypatch
):
    deliver(client, 8)
    original_fit = client.model.fit
    entered, release, delivery_started = Event(), Event(), Event()

    def held_fit(*args, **kwargs):
        entered.set()
        assert release.wait(10)
        return original_fit(*args, **kwargs)

    monkeypatch.setattr(client.model, "fit", held_fit)
    next_weights = [np.full_like(w, 0.2) for w in client.model.get_weights()]

    def next_delivery():
        delivery_started.set()
        return client.receive_weights()

    with ThreadPoolExecutor(max_workers=2) as pool:
        participation = pool.submit(
            client.participate_in_round, *local_data(), epochs=1
        )
        assert entered.wait(10)
        deliver(client, 9, [w.tolist() for w in next_weights])
        delivery = pool.submit(next_delivery)
        assert delivery_started.wait(10)
        assert not delivery.done()
        release.set()
        result = participation.result(timeout=15)
        assert delivery.result(timeout=15)
    assert result["success"] and result["round"] == 8
    token = client.redis.get("federated:update:native-client")
    assert json.loads(client.cipher.decrypt(token))["round"] == 8
    assert client.training_round == 9
    equal(client.model.get_weights(), next_weights)
    assert client._trained_round is None
    assert not client.send_update()["success"]


@pytest.mark.parametrize("tag", [b"4", b"0"])
def test_legacy_model_requires_and_uses_native_redis_round(client, tag):
    client.redis.set("federated:round", tag)
    deliver(client, payload=[w.tolist() for w in client.model.get_weights()])
    assert client.receive_weights()
    assert client.training_round == int(tag)


@pytest.mark.parametrize("tag", [None, b"-1", b"1.0", b"true", b"x" * 21])
def test_invalid_legacy_tag_preserves_model(client, tag):
    if tag is not None:
        client.redis.set("federated:round", tag)
    deliver(client, payload=[w.tolist() for w in client.model.get_weights()])
    assert not client.receive_weights()
    assert client._accepted_round is None


def test_nonfinite_mutated_trained_model_is_not_published(client):
    deliver(client, 2)
    assert client.receive_weights()
    assert client.train_local(*local_data(), epochs=1)["success"]
    bad = client.model.get_weights()
    bad[0][0, 0] = float("nan")
    client.model.set_weights(bad)
    assert not client.send_update()["success"]
    assert client.redis.get("federated:update:native-client") is None
    assert client._published_round is None


@pytest.mark.parametrize(
    "path", ["/federated/client/participate", "/federated/client/train"]
)
def test_native_http_failure_reports_unsuccessful_participation(
    client, native_redis, monkeypatch, path
):
    import asyncio
    import importlib
    import sys

    import httpx
    from fastapi import FastAPI

    _, url = native_redis
    monkeypatch.setenv("REDIS_URL", url)
    monkeypatch.delenv("FEDERATED_ENCRYPTION_KEY", raising=False)
    previous = sys.modules.pop("routes.federated_routes", None)
    module = importlib.import_module("routes.federated_routes")
    monkeypatch.setattr(
        FederatedClient, "simulate_driver_behavior", lambda self: local_data()
    )
    app = FastAPI()
    app.include_router(module.router)

    async def request():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://private-test"
        ) as session:
            return await session.post(
                path, json={"client_id": "http-native", "rounds": 1, "epochs": 1}
            )

    try:
        response = asyncio.run(request())
        assert response.status_code == 200
        body = response.json()
        assert body["success"] is False
        inner = body["data"][0] if path.endswith("/train") else body["data"]
        assert inner["success"] is False
        assert module.server.redis.get("federated:update:http-native") is None
    finally:
        for instance in module._clients.values():
            instance.stop_subscription()
            instance.redis.close()
        module.server.stop_update_consumer()
        module.server.redis.close()
        sys.modules.pop("routes.federated_routes", None)
        if previous is not None:
            sys.modules["routes.federated_routes"] = previous
