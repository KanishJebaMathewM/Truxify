"""Actual TensorFlow models, Fernet envelopes and private native Redis."""

import json
import os
import shutil
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest
import redis
import tensorflow as tf
from federated.federated_server import FederatedServer

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
def server(native_redis, tmp_path, monkeypatch):
    client, url = native_redis
    client.flushdb()
    monkeypatch.delenv("FEDERATED_ENCRYPTION_KEY", raising=False)
    monkeypatch.chdir(tmp_path)
    client.sadd("federated:clients", "A", "B", "C")
    instance = FederatedServer(url, min_clients=3, clients_per_round=3)
    # Only the unrelated background transport is excluded. Redis/Fernet/model
    # admission, aggregation and native H5 checkpoint storage remain real.
    monkeypatch.setattr(instance, "start_update_consumer", lambda: None)
    assert instance.start_round()["round"] == 1
    instance.dp_noise_scale = 0.0
    yield instance
    instance.redis.close()


def envelope(server, weights=None, round_id=None):
    if weights is None:
        weights = [w.tolist() for w in server.model.get_weights()]
    payload = {
        "round": server.round if round_id is None else round_id,
        "weights": weights,
    }
    return server.cipher.encrypt(json.dumps(payload).encode())


def equal(actual, expected):
    assert len(actual) == len(expected)
    for a, b in zip(actual, expected):
        np.testing.assert_array_equal(a, b)


@pytest.mark.parametrize(
    "kind",
    [
        "empty",
        "missing",
        "extra",
        "wrong_shape",
        "nan",
        "infinity",
        "bool",
        "string",
        "float32_overflow",
    ],
)
def test_rejected_native_update_does_not_enter_quorum_or_poison_valid_retry(
    server, kind
):
    before = server.model.get_weights()
    weights = [w.tolist() for w in before]
    if kind == "empty":
        weights = []
    elif kind == "missing":
        weights = weights[:-1]
    elif kind == "extra":
        weights = weights + [weights[-1]]
    elif kind == "wrong_shape":
        weights[0] = [1.0]
    else:
        value = {
            "nan": float("nan"),
            "infinity": float("inf"),
            "bool": True,
            "string": "1",
            "float32_overflow": 1e100,
        }[kind]
        weights[0] = np.full(before[0].shape, value).tolist()
    rejected = server.receive_client_update("A", envelope(server, weights))
    assert rejected["success"] is False
    assert server.client_weights == {}
    assert server.accepted_updates == set()
    assert server.redis.get("federated:accepted") is None
    equal(server.global_weights, before)
    equal(server.model.get_weights(), before)
    # The same participant remains eligible and completes this actual round.
    for client in ("A", "B", "C"):
        assert server.receive_client_update(client, envelope(server))["success"] is True
    assert server.round_completed is True
    assert server.client_weights == {}
    equal(server.global_weights, server.model.get_weights())
    assert all(np.isfinite(w).all() for w in server.global_weights)
    assert os.path.exists("models/federated/model_round_1.h5")


@pytest.mark.parametrize("tag", [True, 1.0, "1", False, 2])
def test_invalid_or_stale_round_never_enters_native_quorum(server, tag):
    result = server.receive_client_update("A", envelope(server, round_id=tag))
    assert result["success"] is False
    assert not server.accepted_updates
    assert not server.client_weights


def test_complete_private_candidate_keeps_native_dtype_and_original_buffers(server):
    original = server.model.get_weights()
    proposal = [w.astype(np.float64) + 0.01 for w in original]
    encoded = envelope(server, [w.tolist() for w in proposal])
    assert server.receive_client_update("A", encoded)["success"] is True
    stored = [w.copy() for w in server.client_weights["A"]]
    proposal[0][:] = 99
    equal(server.client_weights["A"], stored)
    assert all(w.dtype == native.dtype for w, native in zip(stored, original))


@pytest.mark.parametrize(
    "setting,value",
    [
        ("dp_noise_scale", float("nan")),
        ("dp_noise_scale", -1.0),
        ("dp_clip_norm", float("inf")),
        ("dp_clip_norm", True),
    ],
)
def test_failed_candidate_preparation_preserves_model_baseline_and_admitted_buffers(
    server, setting, value
):
    assert server.receive_client_update("A", envelope(server))["success"] is True
    native = server.model.get_weights()
    baseline = [w.copy() for w in server.global_weights]
    buffered = [w.copy() for w in server.client_weights["A"]]
    accepted = set(server.accepted_updates)
    setattr(server, setting, value)
    with pytest.raises((ValueError, TypeError)):
        server._aggregate_weights()
    equal(server.model.get_weights(), native)
    equal(server.global_weights, baseline)
    equal(server.client_weights["A"], buffered)
    assert server.accepted_updates == accepted
    assert server.round_completed is False


def test_invalid_later_buffer_cannot_mutate_an_earlier_valid_client(server):
    server.receive_client_update("A", envelope(server))
    original = [w.copy() for w in server.client_weights["A"]]
    native = server.model.get_weights()
    server.client_weights["B"] = []
    with pytest.raises(ValueError):
        server._aggregate_weights()
    equal(server.client_weights["A"], original)
    equal(server.model.get_weights(), native)
    equal(server.global_weights, native)
    assert server.round_completed is False


def test_duplicate_native_update_is_once_only_under_concurrent_callers(server):
    encoded = envelope(server)
    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(
            executor.map(lambda _: server.receive_client_update("A", encoded), range(2))
        )
    assert all(x["success"] for x in outcomes)
    assert sum(bool(x.get("duplicate")) for x in outcomes) == 1
    assert set(server.client_weights) == {"A"}
    assert server.accepted_updates == {("A", 1)}


def test_concurrent_valid_native_clients_publish_one_complete_model(server):
    encoded = envelope(server)
    with ThreadPoolExecutor(max_workers=3) as executor:
        results = list(
            executor.map(
                lambda client: server.receive_client_update(client, encoded),
                ["A", "B", "C"],
            )
        )
    assert all(result["success"] for result in results)
    assert server.round_completed is True
    assert server.completed_rounds == {1}
    equal(server.global_weights, server.model.get_weights())
    assert json.loads(server.redis.get("federated:accepted"))
    assert server.redis.get("federated:round_completed:1") == b"true"


def test_old_envelope_rejected_after_native_round_restart(server):
    old = envelope(server)
    server.start_round()
    result = server.receive_client_update("A", old)
    assert result["success"] is False
    assert result["error"] == "stale round"
    assert server.client_weights == {}


def test_oversized_or_wrong_transport_bytes_do_not_enter_quorum(server):
    for bad in ("not-bytes", b"x" * (4 * 1024 * 1024 + 1)):
        assert server.receive_client_update("A", bad)["success"] is False
    assert not server.client_weights


def test_valid_native_updates_publish_the_independently_expected_model(server):
    baseline = server.model.get_weights()
    target = [w + np.float32(0.01) for w in baseline]
    encoded = envelope(server, [w.tolist() for w in target])
    for client in ("A", "B", "C"):
        assert server.receive_client_update(client, encoded)["success"] is True
    equal(server.model.get_weights(), target)
    equal(server.global_weights, target)
    assert server.round_completed is True
