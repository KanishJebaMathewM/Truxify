"""Native frame/cache execution with unrelated audio/dlib startup excluded."""
import ast
import asyncio
import importlib.util
import io
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import types
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
import pytest
import redis
from app import execution
from fastapi import APIRouter, FastAPI, File, HTTPException, UploadFile
from httpx import ASGITransport, AsyncClient
from multimodal.vision_execution import (
    frame_owner,
    process_encoded_frame,
    read_latest_vision,
)
from starlette.datastructures import Headers


def native_monitor_class():
    """Load unchanged monitor source with only unused dlib startup isolated."""
    path = Path(__file__).parents[1] / "multimodal/vision_monitor.py"
    spec = importlib.util.spec_from_file_location("native_vision_test_module", path)
    native = importlib.util.module_from_spec(spec)
    adapters = {}
    if importlib.util.find_spec("dlib") is None:
        optional = types.ModuleType("dlib")
        optional.get_frontal_face_detector = lambda: None
        def unavailable_predictor(path):
            raise RuntimeError("unused dlib startup isolated")
        optional.shape_predictor = unavailable_predictor
        adapters["dlib"] = optional
    # Restore only the optional entry; retain newly imported native runtime modules.
    missing = object()
    previous = sys.modules.get("dlib", missing)
    if adapters:
        sys.modules["dlib"] = adapters["dlib"]
    try:
        spec.loader.exec_module(native)
    finally:
        if adapters:
            if previous is missing:
                sys.modules.pop("dlib", None)
            else:
                sys.modules["dlib"] = previous
    return native.VisionMonitor


@pytest.fixture(scope="module")
def monitor():
    binary = os.environ.get("REDIS_SERVER") or shutil.which("redis-server")
    assert binary, "native redis-server required"
    with tempfile.TemporaryDirectory(dir="/tmp", prefix="vision-") as directory:
        socket = directory + "/redis.sock"
        server = subprocess.Popen([binary, "--port", "0", "--unixsocket", socket,
                                   "--save", "", "--appendonly", "no"], stdout=subprocess.DEVNULL)
        client = redis.Redis(unix_socket_path=socket)
        try:
            for _ in range(200):
                try:
                    client.ping()
                    break
                except redis.ConnectionError:
                    time.sleep(.01)
            else:
                pytest.fail("native Redis did not start")
            instance = native_monitor_class()("unix://" + socket)
            try:
                yield instance
            finally:
                instance.face_mesh.close()
                instance.redis.close()
        finally:
            client.close()
            server.terminate()
            server.wait(timeout=5)


@pytest.fixture
def routes(monitor):
    # Exact selected handlers/helper bodies; unrelated audio/hardware routes excluded.
    path = Path(__file__).parents[1] / "routes/safety_routes.py"
    names = {"MAX_UPLOAD_BYTES", "_UPLOAD_CHUNK_BYTES", "_ALLOWED_VISION_MIME",
             "_validate_content_length", "_read_upload", "analyze_vision_frame", "get_vision_status"}
    nodes = []
    for node in ast.parse(path.read_text()).body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in names or isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in names for t in node.targets):
            nodes.append(node)
    scope = {"cv2": cv2, "np": np, "json": json, "datetime": datetime,
             "logger": logging.getLogger(__name__), "router": APIRouter(prefix="/safety"), "File": File,
             "HTTPException": HTTPException, "UploadFile": UploadFile, "vision_monitor": monitor,
             "run_inference": execution.run_inference, "process_encoded_frame": process_encoded_frame,
             "read_latest_vision": read_latest_vision}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), "exec"), scope)  # noqa: S102
    return scope


def encoded():
    return cv2.imencode(".png", np.zeros((64, 64, 3), np.uint8))[1].tobytes()


def upload(data=None, mime="image/png", length=None):
    headers = {"content-type": mime}
    if length is not None:
        headers["content-length"] = str(length)
    return UploadFile(io.BytesIO(encoded() if data is None else data), filename="native.png",
                      headers=Headers(headers))


@pytest.mark.asyncio
async def test_actual_graph_wait_does_not_stall_loop(routes, monitor, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    original = monitor.face_mesh.process
    def paused(rgb):
        actual = original(rgb)
        entered.set()
        assert release.wait(10)
        return actual
    monkeypatch.setattr(monitor.face_mesh, "process", paused)
    task = asyncio.create_task(routes["analyze_vision_frame"](upload()))
    try:
        assert await asyncio.to_thread(entered.wait, 5)
        await asyncio.sleep(.01)
        assert not task.done()  # Native work remains admitted while the loop runs.
    finally:
        release.set()
    result = await task
    assert result["success"] and result["data"]["status"] == "NO_FACE_DETECTED"


@pytest.mark.asyncio
async def test_real_redis_pause_status_runs_off_loop(routes, monitor):
    monitor.process_frame(np.zeros((64, 64, 3), np.uint8))
    await asyncio.to_thread(monitor.redis.execute_command, "CLIENT", "PAUSE", 300, "ALL")
    task = asyncio.create_task(routes["get_vision_status"]())
    await asyncio.sleep(.02)
    assert not task.done()
    assert (await task)["success"]


@pytest.mark.parametrize("raw", [None, b"null", b"{}", b"false", b"0", b"[]"])
@pytest.mark.asyncio
async def test_status_preserves_present_and_missing_json(routes, monitor, raw):
    if raw is None:
        monitor.redis.delete("vision:latest")
    else:
        monitor.redis.set("vision:latest", raw)
    result = await routes["get_vision_status"]()
    if raw is None:
        assert result["data"] is None and "message" in result and "timestamp" not in result
    else:
        assert result["data"] == json.loads(raw) and "timestamp" in result and "message" not in result


@pytest.mark.parametrize("code", [503, 504])
@pytest.mark.parametrize("handler", ["analyze_vision_frame", "get_vision_status"])
@pytest.mark.asyncio
async def test_http_admission_status_is_not_hidden(routes, code, handler):
    async def rejected(*args):
        raise HTTPException(code, "native admission outcome")
    routes["run_inference"] = rejected
    with pytest.raises(HTTPException) as error:
        if handler == "analyze_vision_frame":
            await routes[handler](upload())
        else:
            await routes[handler]()
    assert error.value.status_code == code


@pytest.mark.asyncio
async def test_cancelled_http_keeps_admitted_frame_capacity(routes, monitor, monkeypatch):
    monkeypatch.setattr(execution, "ML_MAX_CONCURRENT_INFERENCE", 1)
    monkeypatch.setattr(execution, "ML_INFERENCE_MAX_WAITERS", 0)
    entered, release = threading.Event(), threading.Event()
    original = monitor.face_mesh.process
    def paused(rgb):
        result = original(rgb)
        entered.set()
        assert release.wait(10)
        return result
    monkeypatch.setattr(monitor.face_mesh, "process", paused)
    task = asyncio.create_task(routes["analyze_vision_frame"](upload()))
    try:
        assert await asyncio.to_thread(entered.wait, 5)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        with pytest.raises(HTTPException) as error:
            await execution.run_inference(lambda: "cannot enter")
        assert error.value.status_code == 503
    finally:
        release.set()
        for _ in range(200):
            with execution._inference_guard:
                active = execution._active_inference
            if not active:
                break
            await asyncio.sleep(.01)
    assert await execution.run_inference(lambda: "recovered") == "recovered"


def test_direct_and_encoded_calls_share_whole_native_owner(monitor, monkeypatch):
    entered, release, second_started, second_native = (threading.Event() for _ in range(4))
    original = monitor.face_mesh.process
    calls = []
    def paused(rgb):
        calls.append(threading.get_ident())
        result = original(rgb)
        if len(calls) == 1:
            entered.set()
            assert release.wait(10)
        else:
            second_native.set()
        return result
    monkeypatch.setattr(monitor.face_mesh, "process", paused)
    def second():
        second_started.set()
        return process_encoded_frame(monitor, encoded())
    with ThreadPoolExecutor(2) as pool:
        first = pool.submit(monitor.process_frame, np.zeros((64, 64, 3), np.uint8))
        assert entered.wait(5)
        other = pool.submit(second)
        try:
            assert second_started.wait(5)
            assert not second_native.wait(.1)
        finally:
            release.set()
        assert first.result(5)["status"] == other.result(5)["status"] == "NO_FACE_DETECTED"
    assert frame_owner(monitor) is monitor._frame_operation_owner


def test_direct_input_shape_is_owned_through_native_processing(monitor, monkeypatch):
    source = np.zeros((64, 64, 3), np.uint8)
    original = monitor.face_mesh.process
    # A controlled landmark receipt exercises downstream geometry provenance;
    # actual FaceMesh still runs first. This is not a detection-quality claim.
    points = [types.SimpleNamespace(x=.2 + (i % 17) / 30, y=.2 + (i % 13) / 30)
              for i in range(468)]
    def resize_caller(rgb):
        original(rgb)
        source.shape = (32, 128, 3)
        return types.SimpleNamespace(multi_face_landmarks=[types.SimpleNamespace(landmark=points)])
    monkeypatch.setattr(monitor.face_mesh, "process", resize_caller)
    seen = []
    original_distraction = monitor.detect_distraction
    def distraction(landmarks, frame_size=None):
        seen.append(frame_size)
        return original_distraction(landmarks, frame_size=frame_size)
    monkeypatch.setattr(monitor, "detect_distraction", distraction)
    monitor.process_frame(source)
    assert seen == [(64, 64)]
    assert source.shape == (32, 128, 3)


@pytest.mark.parametrize("frame", [None, np.zeros((0, 2, 3), np.uint8),
                                   np.zeros((2, 2, 4), np.uint8), np.zeros((2, 2, 3)),
                                   np.zeros((8193, 1, 3), np.uint8)])
def test_invalid_frames_keep_unknown_and_reset_contract(monitor, frame):
    monitor.eye_closed_frames = 25
    monitor.distraction_frames = 40
    report = monitor.process_frame(frame)
    assert report["overall_status"] == "UNKNOWN" and report["status"] == "ERROR"
    assert monitor.eye_closed_frames == monitor.distraction_frames == 0


@pytest.mark.asyncio
async def test_upload_admission_retained(routes):
    for file, expected in [(upload(mime="text/plain"), 415), (upload(length=10 * 1024 * 1024 + 1), 413)]:
        with pytest.raises(HTTPException) as error:
            await routes["analyze_vision_frame"](file)
        assert error.value.status_code == expected


@pytest.mark.asyncio
async def test_mounted_selected_native_endpoint(routes):
    app = FastAPI()
    app.include_router(routes["router"])
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://local") as client:
        result = await client.post("/safety/vision/analyze", files={"file": ("native.png", encoded(), "image/png")})
    assert result.status_code == 200
    assert result.json()["data"]["overall_status"] == "UNKNOWN"


def test_private_copy_failure_keeps_native_unknown_contract(monitor, monkeypatch):
    from multimodal import vision_execution
    frame = np.zeros((64, 64, 3), np.uint8)
    monitor.eye_closed_frames = 25
    def failed_copy(*args, **kwargs):
        raise MemoryError("controlled frame allocation failure")
    with monkeypatch.context() as scoped:
        scoped.setattr(vision_execution.np, "array", failed_copy)
        report = monitor.process_frame(frame)
    assert report["status"] == "ERROR" and report["overall_status"] == "UNKNOWN"
    assert monitor.eye_closed_frames == 0
    assert monitor.process_frame(frame)["status"] == "NO_FACE_DETECTED"


def test_encoded_native_frame_does_not_allocate_second_bgr_copy(monitor, monkeypatch):
    from multimodal import vision_execution
    contents = encoded()
    copies = []
    original = vision_execution.np.array
    def traced_array(value, *args, **kwargs):
        if isinstance(value, np.ndarray) and value.ndim == 3 and value.shape[2] == 3:
            copies.append(value.shape)
        return original(value, *args, **kwargs)
    with monkeypatch.context() as scoped:
        scoped.setattr(vision_execution.np, "array", traced_array)
        report = process_encoded_frame(monitor, contents)
        assert copies == []
        assert report["status"] == "NO_FACE_DETECTED"
        monitor.process_frame(np.zeros((64, 64, 3), np.uint8))
        assert copies == [(64, 64, 3)]
