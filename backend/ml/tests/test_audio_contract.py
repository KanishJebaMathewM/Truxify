"""Real DSP/Keras/Redis audio contracts; never opens a recording device."""

import ast
import asyncio
import io
import json
import logging
import os
import shutil
import subprocess
import tempfile
import time
from datetime import datetime
from pathlib import Path

import librosa
import numpy as np
import pytest
import redis
import soundfile as sf
import tensorflow as tf
from fastapi import File, HTTPException, UploadFile
from multimodal.audio_contract import admit_probabilities, admit_waveform, feature_block
from multimodal.audio_monitor import AudioMonitor
from starlette.datastructures import Headers

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


@pytest.fixture(scope="module")
def monitor(native_redis):
    instance = AudioMonitor(native_redis[1])
    yield instance
    instance.redis.close()


def wave(rate=16000):
    return (0.1 * np.sin(2 * np.pi * 440 * np.arange(rate * 2) / rate)).astype(
        np.float32
    )


def select(model, index):
    weights = [np.zeros_like(w) for w in model.get_weights()]
    weights[-1][index] = 6
    model.set_weights(weights)


@pytest.mark.parametrize(
    "audio, rate",
    [
        ([], 16000),
        ([np.nan], 16000),
        ([np.inf], 16000),
        ([2.0], 16000),
        ([True], 16000),
        (["0"], 16000),
        ([[[0.0]]], 16000),
        ([[0.0, 0.0, 0.0]], 16000),
        ([0.0], True),
        ([0.0], 7999),
        ([0.0], 192001),
        ([0.0], 16000.0),
        (np.zeros(160001), 16000),
    ],
)
def test_invalid_pcm_is_rejected(audio, rate):
    with pytest.raises(ValueError):
        admit_waveform(audio, rate)


def test_waveform_is_owned_and_stereo_resampling_matches_native_reference():
    stereo = np.stack([wave(48000), wave(48000) * 0.5], axis=1)
    original = stereo.copy()
    expected = librosa.resample(stereo.mean(axis=1), orig_sr=48000, target_sr=16000)
    actual = admit_waveform(stereo, 48000)
    assert actual.shape == (32000,)
    np.testing.assert_allclose(actual, expected, atol=1e-7)
    actual[:] = 0
    np.testing.assert_array_equal(stereo, original)
    mono = wave()
    admitted = admit_waveform(mono)
    admitted[:] = 0
    assert np.any(mono)


@pytest.mark.parametrize("length", [1, 1000, 1001])
def test_feature_family_has_fixed_slot(length):
    values = np.arange(length, dtype=np.float32)
    result = feature_block(values)
    assert result.shape == (1000,)
    np.testing.assert_array_equal(result[: min(length, 1000)], values[:1000])
    assert not result[min(length, 1000) :].any()


@pytest.mark.parametrize(
    "predictions",
    [
        [[1, 0]],
        [[np.nan, 0, 0, 0, 0]],
        [[np.inf, 0, 0, 0, 0]],
        [[0.1, 0.1, 0.1, 0.1, 0.1]],
        [[1.1, -0.1, 0, 0, 0]],
        [1, 0, 0, 0, 0],
        [[True, False, False, False, False]],
    ],
)
def test_invalid_classifier_probabilities_are_rejected(predictions):
    with pytest.raises(ValueError):
        admit_probabilities(predictions, 5)


def test_actual_feature_layout_matches_independent_dsp(monitor):
    audio = wave()
    result = monitor.extract_features(audio)
    assert result.shape == (3000,)
    mfcc = librosa.feature.mfcc(y=audio, sr=16000, n_mfcc=13).ravel()
    chroma = librosa.feature.chroma_stft(y=audio, sr=16000).ravel()
    np.testing.assert_allclose(result[1000 : 1000 + mfcc.size], mfcc, atol=1e-5)
    np.testing.assert_allclose(result[2000 : 2000 + chroma.size], chroma, atol=1e-5)
    assert not result[1000 + mfcc.size : 2000].any()
    assert not result[2000 + chroma.size :].any()
    select(monitor.speech_emotion_model, 1)
    emotion = monitor.analyze_speech_emotion(audio)
    assert emotion["status"] == "OK" and emotion["emotion"] == "happy"


def test_real_normal_class_is_not_honk_and_native_report_serializes(monitor):
    select(monitor.emergency_sound_model, 4)
    select(monitor.honk_detection_model, 4)
    select(monitor.speech_emotion_model, 0)
    monitor.honk_count = 0
    report = monitor.process_audio(wave())
    assert report["status"] == "OK" and report["alert_level"] == "SAFE"
    assert report["honk"]["is_honk"] is False
    assert report["honk"]["confidence"] < 0.01
    assert monitor.get_alert(report)["level"] == "SAFE"
    cached = json.loads(monitor.redis.get("audio:latest"))
    assert cached == report
    assert 0 < monitor.redis.ttl("audio:latest") <= 60
    json.dumps(report, allow_nan=False)


def test_real_honk_class_crosses_threshold_and_streak(monitor):
    select(monitor.emergency_sound_model, 4)
    select(monitor.honk_detection_model, 0)
    monitor.honk_count = 3
    report = monitor.process_audio(wave())
    assert report["honk"]["is_honk"] is True
    assert report["honk"]["honk_count"] == 4
    assert report["alert_level"] == "WARNING"


def test_real_emergency_class_is_critical(monitor):
    select(monitor.emergency_sound_model, 1)
    select(monitor.honk_detection_model, 4)
    report = monitor.process_audio(wave())
    assert report["emergency"]["detected"] == "siren"
    assert report["alert_level"] == "CRITICAL"
    select(monitor.emergency_sound_model, 4)


def test_invalid_input_replaces_stale_safe_cache_with_unknown(monitor):
    monitor.redis.set("audio:latest", json.dumps({"alert_level": "SAFE"}))
    monitor.honk_count = 4
    report = monitor.process_audio(np.full(32000, np.nan))
    assert report["status"] == "ERROR" and report["alert_level"] == "UNKNOWN"
    assert monitor.get_alert(report)["level"] == "UNKNOWN"
    assert json.loads(monitor.redis.get("audio:latest")) == report
    assert monitor.honk_count == 0


def test_native_nonfinite_classifier_cannot_publish_safe(monitor):
    weights = monitor.speech_emotion_model.get_weights()
    weights[-1][:] = np.nan
    monitor.speech_emotion_model.set_weights(weights)
    try:
        report = monitor.process_audio(wave())
        assert report["emotion"]["status"] == "ERROR"
        assert report["alert_level"] == "UNKNOWN"
        json.dumps(report, allow_nan=False)
    finally:
        select(monitor.speech_emotion_model, 0)


def test_stereo_source_rate_reaches_actual_models(monitor):
    select(monitor.emergency_sound_model, 4)
    select(monitor.honk_detection_model, 4)
    stereo = np.stack([wave(48000), wave(48000)], axis=1)
    report = monitor.process_audio(stereo, sample_rate=48000)
    assert report["status"] == "OK" and report["sample_rate"] == 16000


def actual_upload_function(monitor):
    # Execute the unchanged endpoint/helpers directly; heavy unrelated vision
    # startup is excluded. The real decoder, upload reader and monitor are used.
    source = Path(__file__).parents[1] / "routes/safety_routes.py"
    tree = ast.parse(source.read_text())
    selected = []
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name)
            and target.id
            in {"MAX_UPLOAD_BYTES", "_UPLOAD_CHUNK_BYTES", "_ALLOWED_AUDIO_MIME"}
            for target in node.targets
        ):
            selected.append(node)
        elif isinstance(
            node, (ast.FunctionDef, ast.AsyncFunctionDef)
        ) and node.name in {
            "_validate_content_length",
            "_read_upload",
            "analyze_audio",
        }:
            node.decorator_list = []
            selected.append(node)
    namespace = {
        "sf": sf,
        "io": io,
        "datetime": datetime,
        "HTTPException": HTTPException,
        "UploadFile": UploadFile,
        "File": File,
        "audio_monitor": monitor,
        "logger": logging.getLogger(__name__),
    }
    exec(  # noqa: S102 - execute only selected trusted repository functions
        compile(ast.Module(body=selected, type_ignores=[]), str(source), "exec"),
        namespace,
    )
    return namespace["analyze_audio"]


@pytest.mark.parametrize("rate", [8000, 48000])
def test_actual_upload_decodes_stereo_source_rate(monitor, rate):
    select(monitor.emergency_sound_model, 4)
    select(monitor.honk_detection_model, 4)
    encoded = io.BytesIO()
    sf.write(encoded, np.stack([wave(rate), wave(rate)], axis=1), rate, format="WAV")
    encoded.seek(0)
    upload = UploadFile(
        file=encoded,
        filename="synthetic.wav",
        headers=Headers({"content-type": "audio/wav"}),
    )
    result = asyncio.run(actual_upload_function(monitor)(upload))
    assert result["success"] is True
    assert result["data"]["sample_rate"] == 16000
    assert result["data"]["status"] == "OK"


def test_actual_upload_invalid_observation_does_not_report_success(monitor):
    encoded = io.BytesIO()
    sf.write(encoded, np.full(32000, np.nan), 16000, format="WAV", subtype="FLOAT")
    encoded.seek(0)
    upload = UploadFile(
        file=encoded,
        filename="synthetic.wav",
        headers=Headers({"content-type": "audio/wav"}),
    )
    result = asyncio.run(actual_upload_function(monitor)(upload))
    assert result["success"] is False
    assert result["data"]["alert_level"] == "UNKNOWN"


def test_unavailable_native_cache_retains_complete_unknown_report(monitor):
    original = monitor.redis
    monitor.redis = redis.Redis(
        unix_socket_path="/private/tmp/no-audio-cache-17753.sock"
    )
    try:
        result = monitor.process_audio(np.full(32000, np.nan))
        assert result["alert_level"] == "UNKNOWN"
        assert monitor.get_alert(result)["level"] == "UNKNOWN"
        json.dumps(result, allow_nan=False)
    finally:
        monitor.redis.close()
        monitor.redis = original


def test_native_resampling_overshoot_is_not_rejected_as_external_pcm(monitor):
    select(monitor.emergency_sound_model, 4)
    select(monitor.honk_detection_model, 4)
    select(monitor.speech_emotion_model, 0)
    source = np.resize(np.array([1.0, 1.0, -1.0, -1.0], dtype=np.float32), 16000)
    resampled = admit_waveform(source, 8000)
    assert np.abs(resampled).max() > 1.0  # real filter ringing, no signal mock
    result = monitor.process_audio(source, sample_rate=8000)
    assert result["status"] == "OK"
    assert result["alert_level"] == "SAFE"
    np.testing.assert_array_equal(source[:4], [1.0, 1.0, -1.0, -1.0])
