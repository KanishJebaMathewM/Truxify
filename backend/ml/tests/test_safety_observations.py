"""Actual fusion/HTTP behavior with an isolated native Redis process."""

import json
import os
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timedelta

import pytest
import redis
from fastapi import FastAPI
from fastapi.testclient import TestClient
from multimodal.sensor_fusion import FEED_KEYS, SensorFusion
from routes import safety_fusion_routes


@pytest.fixture(scope="module")
def native_redis():
    binary = os.environ.get("REDIS_SERVER") or shutil.which("redis-server")
    if not binary:
        pytest.fail(
            "Install redis-server or set REDIS_SERVER; native coverage is required."
        )
    with tempfile.TemporaryDirectory(dir="/tmp", prefix="fusion-") as directory:
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
            stderr=subprocess.PIPE,
        )
        client = redis.Redis(unix_socket_path=path)
        try:
            for _ in range(200):
                try:
                    client.ping()
                    break
                except redis.ConnectionError:
                    if process.poll() is not None:
                        pytest.fail(process.stderr.read().decode())
                    time.sleep(0.01)
            else:
                pytest.fail("Native Redis startup timed out")
            yield client
        finally:
            client.close()
            process.terminate()
            process.wait(timeout=5)


@pytest.fixture
def engine(native_redis):
    native_redis.flushdb()
    instance = SensorFusion()
    instance.redis = native_redis
    yield instance


def observations():
    stamp = datetime.now().astimezone().isoformat()
    return (
        {"drowsiness": {"status": "AWAKE"}, "timestamp": stamp},
        {"emergency": {"is_emergency": False}, "timestamp": stamp},
        {"speed": 50, "seatbelt": True, "timestamp": stamp},
    )


def strict(report):
    return json.loads(json.dumps(report, allow_nan=False))


@pytest.mark.parametrize(
    "bad",
    [
        None,
        {},
        [],
        {"timestamp": "2026-10-07"},
        {"status": "ERROR"},
        {"status": "NO_FACE_DETECTED"},
        {"drowsiness": {"status": "UNKNOWN"}},
        {"drowsiness": {"status": "invalid"}},
        {"drowsiness": []},
    ],
)
def test_non_observation_never_certifies_safe(engine, bad):
    report = engine.fuse_data(bad, {}, {})
    assert report["alert_level"] == "UNKNOWN"
    assert report["data_available"] is False
    assert report["coverage_complete"] is False
    assert "Wait for valid observations" in report["actions"][1]
    assert strict(report) == json.loads(engine.redis.get("fusion:latest"))


@pytest.mark.parametrize(
    "sensor",
    [
        {"speed": float("nan")},
        {"speed": float("inf")},
        {"speed": -1},
        {"speed": True},
        {"speed": "50"},
        {"speed": 10**400},
        {"seatbelt": 1},
        {"seatbelt": "false"},
        {"acceleration": []},
        {"steering_angle": None},
        {"speed": 20, "seatbelt": "false"},
    ],
)
def test_invalid_sensor_does_not_provide_coverage(engine, sensor):
    vision, audio, _ = observations()
    report = engine.fuse_data(vision, audio, sensor)
    assert report["alert_level"] == "UNKNOWN"
    assert report["availability"]["sensors"]["reason"] == "invalid"
    assert report["components"]["sensors"] == {}
    strict(report)


@pytest.mark.parametrize(
    "audio",
    [
        {"emergency": {"is_emergency": 1}},
        {"emergency": []},
        {"honk": {"is_honk": True, "honk_count": True}},
        {"honk": {"is_honk": True, "honk_count": -1}},
        {"honk": {"is_honk": True, "honk_count": 10**400}},
        {"emotion": {"emotion": []}},
        {"emotion": {"emotion": "UNKNOWN"}},
    ],
)
def test_audio_invalid_or_unknown_is_not_safe_evidence(engine, audio):
    vision, _, sensors = observations()
    report = engine.fuse_data(vision, audio, sensors)
    assert report["alert_level"] == "UNKNOWN"
    assert not report["availability"]["audio"]["available"]
    strict(report)


def test_full_observed_risk_matches_independent_coefficients(engine):
    vision, audio, sensors = observations()
    vision.update(drowsiness={"status": "DROWSY"}, distraction={"status": "DISTRACTED"})
    audio.update(
        emergency={"is_emergency": True},
        honk={"is_honk": True, "honk_count": 4},
        emotion={"emotion": "angry"},
    )
    sensors.update(speed=90, acceleration=-8, steering_angle=40, seatbelt=False)
    report = engine.fuse_data(vision, audio, sensors)
    assert report["fusion_risk"] == pytest.approx(0.7 * 0.5 + 0.8 * 0.3 + 0.8 * 0.2)
    assert report["alert_level"] == "WARNING"
    assert report["coverage_complete"] is True
    assert strict(report) == json.loads(engine.redis.get("fusion:latest"))
    assert 0 < engine.redis.ttl("fusion:latest") <= 60


def test_missing_feed_keeps_fixed_weights_and_unknown(engine):
    report = engine.fuse_data({"drowsiness": {"status": "DROWSY"}}, {}, {})
    assert report["fusion_risk"] == pytest.approx(0.4 * 0.5)
    assert report["alert_level"] == "UNKNOWN"
    assert report["data_available"] is True


def test_report_owns_only_recognized_values(engine):
    vision, audio, sensors = observations()
    vision["irrelevant"] = object()
    report = engine.fuse_data(vision, audio, sensors)
    vision["drowsiness"]["status"] = "DROWSY"
    sensors["speed"] = 100
    assert report["components"]["vision"]["drowsiness"]["status"] == "AWAKE"
    assert report["components"]["sensors"]["speed"] == 50
    assert "irrelevant" not in report["components"]["vision"]
    assert report["alert_level"] == "SAFE"
    strict(report)


def seed(engine, frames):
    for key, frame in zip(FEED_KEYS.values(), frames):
        engine.redis.set(key, json.dumps(frame))


def test_empty_cached_report_has_no_fabricated_sensor_values(engine):
    for _ in range(5):
        report = engine.get_safety_report()
        assert report["alert_level"] == "UNKNOWN"
        assert report["fusion_risk"] == 0
        assert report["components"] == {name: {} for name in FEED_KEYS}
        assert report["data_available"] is False
        strict(report)


@pytest.mark.parametrize(
    "raw,reason",
    [
        ("{", "invalid"),
        ("[]", "invalid"),
        ('{"speed": NaN}', "invalid"),
        ('{"speed": 40}', "invalid"),
        ('"' + "x" * 65537 + '"', "invalid"),
        (
            json.dumps(
                {
                    "speed": 50,
                    "timestamp": (
                        datetime.now().astimezone() - timedelta(seconds=90)
                    ).isoformat(),
                }
            ),
            "stale",
        ),
        (
            json.dumps(
                {
                    "speed": 50,
                    "timestamp": (
                        datetime.now().astimezone() + timedelta(seconds=90)
                    ).isoformat(),
                }
            ),
            "future",
        ),
    ],
)
def test_cached_frame_protocol(engine, raw, reason):
    seed(engine, observations())
    engine.redis.set("sensor:latest", raw)
    report = engine.get_safety_report()
    assert report["alert_level"] == "UNKNOWN"
    assert report["availability"]["sensors"]["reason"] == reason
    strict(report)


def test_cached_unknown_emotion_does_not_erase_valid_emergency_observation(engine):
    vision, audio, sensors = observations()
    audio["emotion"] = {"emotion": "unknown"}
    seed(engine, (vision, audio, sensors))
    report = engine.get_safety_report()
    assert report["alert_level"] == "SAFE"
    assert report["availability"]["audio"]["fields"] == ["emergency"]


def test_omitted_reads_cache_but_explicit_empty_does_not(engine):
    seed(engine, observations())
    assert engine.analyze()["coverage_complete"] is True
    report = engine.analyze({}, None, None)
    assert report["alert_level"] == "UNKNOWN"
    assert report["availability"]["vision"]["source"] == "request"
    assert report["availability"]["vision"]["reason"] == "missing"
    assert report["availability"]["audio"]["source"] == "cache"


def test_native_read_only_redis_publication_failure(engine):
    engine.redis.execute_command(
        "ACL", "SETUSER", "fusion-reader", "on", ">local-test-only", "~*", "+mget"
    )
    reader = redis.Redis(
        unix_socket_path=engine.redis.connection_pool.connection_kwargs["path"],
        username="fusion-reader",
        password="local-test-only",
    )
    try:
        restricted = SensorFusion()
        restricted.redis = reader
        report = restricted.fuse_data(*observations())
        assert report["alert_level"] == "UNKNOWN"
        assert report["persistence_available"] is False
        assert report["coverage_complete"] is True
        assert "error" not in report
        strict(report)
    finally:
        reader.close()


def test_native_unavailable_cache_returns_complete_unknown(engine):
    unavailable = SensorFusion()
    unavailable.redis = redis.Redis(unix_socket_path="/tmp/truxify-no-such-redis.sock")
    report = unavailable.get_safety_report()
    assert report["alert_level"] == "UNKNOWN"
    assert report["data_available"] is False
    assert report["persistence_available"] is False
    assert all(
        v["reason"] == "cache_unavailable" for v in report["availability"].values()
    )
    assert report["alert_message"]
    strict(report)


@pytest.fixture
def http_client(engine, monkeypatch):
    monkeypatch.setattr(safety_fusion_routes, "sensor_fusion", engine)
    app = FastAPI()
    app.include_router(safety_fusion_routes.router, prefix="/safety")
    with TestClient(app) as client:
        yield client


def test_actual_report_response_keeps_unknown_metadata(http_client):
    response = http_client.get("/safety/fusion/report")
    assert response.status_code == 200
    report = response.json()
    assert report["alert_level"] == "UNKNOWN"
    assert report["data_available"] is False
    assert report["coverage_complete"] is False
    assert set(report["availability"]) == set(FEED_KEYS)
    assert report["persistence_available"] is True


def test_actual_analyze_cache_and_explicit_empty(http_client, engine):
    seed(engine, observations())
    assert (
        http_client.post("/safety/fusion/analyze").json()["data"]["alert_level"]
        == "SAFE"
    )
    response = http_client.post("/safety/fusion/analyze", json={"vision_data": {}})
    assert response.status_code == 200
    assert response.json()["data"]["alert_level"] == "UNKNOWN"
    assert response.json()["data"]["availability"]["vision"]["source"] == "request"


def test_actual_invalid_numeric_body_returns_json_unknown(http_client):
    vision, audio, sensors = observations()
    sensors["seatbelt"] = "false"
    response = http_client.post(
        "/safety/fusion/analyze",
        json={
            "vision_data": vision,
            "audio_data": audio,
            "sensor_data": sensors,
        },
    )
    assert response.status_code == 200
    assert response.json()["data"]["alert_level"] == "UNKNOWN"
