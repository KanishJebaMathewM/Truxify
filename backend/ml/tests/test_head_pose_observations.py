"""Synthetic native OpenCV geometry and actual selected VisionMonitor methods.

MediaPipe/dlib/Keras construction is excluded; the controlled landmark provider
supplies independently projected geometry, not mocked pose mathematics.
"""

import ast
import json
import logging
import os
import shutil
import subprocess
import tempfile
import time
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import pytest
import redis
from multimodal.head_pose import estimate_head_pose
from scipy.spatial import distance as dist


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


def actual_monitor_class():
    path = Path(__file__).parents[1] / "multimodal/vision_monitor.py"
    module = ast.parse(path.read_text())
    original = next(
        n
        for n in module.body
        if isinstance(n, ast.ClassDef) and n.name == "VisionMonitor"
    )
    methods = {
        "eye_aspect_ratio",
        "detect_drowsiness",
        "detect_distraction",
        "_estimate_head_pose",
        "_unknown_frame",
        "process_frame",
        "_determine_overall_status",
        "get_alert",
    }
    original.body = [
        n for n in original.body if isinstance(n, ast.FunctionDef) and n.name in methods
    ]
    namespace = {
        "Dict": dict,
        "logger": logging.getLogger(__name__),
        "datetime": datetime,
        "cv2": cv2,
        "np": np,
        "json": json,
        "redis": redis,
        "dist": dist,
        "estimate_head_pose": estimate_head_pose,
    }
    exec(  # noqa: S102 - trusted selected repository methods
        compile(ast.Module(body=[original], type_ignores=[]), str(path), "exec"),
        namespace,
    )
    return namespace["VisionMonitor"]


def projection(
    yaw=0.0, pitch=0.0, roll=0.0, size=(640, 480), camera=None, distortion=None
):
    # Independent object/template declaration and composed axis rotations.
    objects = np.array(
        [
            [0.0, 0, 0],
            [0, 330, 65],
            [-225, -170, 135],
            [225, -170, 135],
            [-150, 150, 125],
            [150, 150, 125],
        ]
    )
    radians = np.radians([pitch, yaw, roll])
    axes = np.eye(3)
    matrices = [cv2.Rodrigues(axis * angle)[0] for axis, angle in zip(axes, radians)]
    rotation = matrices[2] @ matrices[1] @ matrices[0]
    vector = cv2.Rodrigues(rotation)[0]
    width, height = size
    if camera is None:
        camera = np.array(
            [[max(size), 0, width / 2], [0, max(size), height / 2], [0, 0, 1.0]],
            dtype=np.float64,
        )
    if distortion is None:
        distortion = np.zeros(4)
    image = cv2.projectPoints(
        objects, vector, np.array([0.0, 0, 1500.0]), camera, distortion
    )[0].reshape(6, 2)
    landmarks = np.tile([width / 2, height / 2], (468, 1))
    for index, point in zip((1, 152, 33, 263, 61, 291), image):
        landmarks[index] = point
    # Actual EAR geometry remains open, isolating distraction decisions.
    left = landmarks[33].copy()
    right = landmarks[263].copy()
    for index, delta in zip(
        (160, 158, 133, 153, 144), ((5, -5), (15, -5), (20, 0), (15, 5), (5, 5))
    ):
        landmarks[index] = left + delta
    for index, delta in zip(
        (362, 385, 387, 373, 380), ((-20, 0), (-15, -5), (-5, -5), (-5, 5), (-15, 5))
    ):
        landmarks[index] = right + delta
    return landmarks


@pytest.fixture
def monitor(native_redis):
    instance = actual_monitor_class()()
    instance.redis = native_redis[0]
    instance.eye_closed_frames = 0
    instance.distraction_frames = 0
    instance.safety_thresholds = {
        "eye_aspect_ratio": 0.25,
        "drowsiness_frames": 20,
        "head_pose_threshold": 30,
        "distraction_frames": 30,
    }
    return instance


@pytest.mark.parametrize(
    "angles",
    [
        (0, 0, 0),
        (45, 0, 0),
        (-45, 0, 0),
        (0, 45, 0),
        (0, -45, 0),
        (0, 0, 40),
        (60, 30, -20),
        (-60, -35, 20),
    ],
)
def test_native_pose_recovers_independent_axis_rotation(angles):
    points = projection(*angles)
    result = estimate_head_pose(points, (640, 480))
    for name, expected in zip(("yaw", "pitch", "roll"), angles):
        assert result[name] == pytest.approx(expected, abs=1e-6)
    assert result["reprojection_error_px"] < 1e-6
    assert result["camera_source"] == "assumed_pinhole"
    json.dumps(result, allow_nan=False)


@pytest.mark.parametrize("seed", range(20))
def test_seeded_pose_with_calibrated_intrinsics_and_distortion(seed):
    rng = np.random.default_rng(seed)
    angles = rng.uniform([-65, -50, -40], [65, 50, 40])
    camera = np.array([[900.0, 0, 300.0], [0, 700.0, 250.0], [0, 0, 1.0]])
    distortion = np.array([-0.05, 0.01, 0.001, -0.002, 0.0])
    points = projection(*angles, camera=camera, distortion=distortion)
    before = points.copy()
    result = estimate_head_pose(points, (640, 480), camera, distortion)
    for field, expected in zip(("yaw", "pitch", "roll"), angles):
        assert result[field] == pytest.approx(expected, abs=1e-5)
    assert result["camera_source"] == "provided"
    np.testing.assert_array_equal(points, before)


@pytest.mark.parametrize(
    "kind",
    [
        "missing",
        "short",
        "shape",
        "bool",
        "complex",
        "nan",
        "inf",
        "outside",
        "duplicate",
        "collinear",
    ],
)
def test_invalid_complete_landmark_geometry_is_rejected(kind):
    points = projection()
    if kind == "missing":
        points = None
    elif kind == "short":
        points = points[:100]
    elif kind == "shape":
        points = points[:, 0]
    elif kind == "bool":
        points = points.astype(bool)
    elif kind == "complex":
        points = points.astype(complex)
    elif kind == "nan":
        points[2, 0] = np.nan
    elif kind == "inf":
        points[2, 0] = np.inf
    elif kind == "outside":
        points[2, 0] = 2000
    elif kind == "duplicate":
        points[:] = [320, 240]
    elif kind == "collinear":
        points[:, 1] = 240
    with pytest.raises(ValueError):
        estimate_head_pose(points, (640, 480))


@pytest.mark.parametrize(
    "size", [None, (), (True, 480), (640.0, 480), (0, 480), (8193, 480), (640, 0)]
)
def test_frame_shape_must_be_known_and_bounded(size):
    with pytest.raises(ValueError):
        estimate_head_pose(projection(), size)


@pytest.mark.parametrize(
    "kind", ["shape", "nan", "negative_focal", "skew", "bottom_row"]
)
def test_complete_camera_admission(kind):
    camera = np.array([[640.0, 0, 320], [0, 640.0, 240], [0, 0, 1.0]])
    if kind == "shape":
        camera = camera[:2]
    elif kind == "nan":
        camera[0, 0] = np.nan
    elif kind == "negative_focal":
        camera[0, 0] = -1
    elif kind == "skew":
        camera[0, 1] = 1
    elif kind == "bottom_row":
        camera[2, 2] = 2
    with pytest.raises(ValueError):
        estimate_head_pose(projection(), (640, 480), camera)


@pytest.mark.parametrize(
    "distortion",
    [np.zeros(3), np.full(4, np.nan), np.zeros((4, 1)), np.zeros(4, dtype=bool)],
)
def test_distortion_shape_and_finiteness(distortion):
    with pytest.raises(ValueError):
        estimate_head_pose(projection(), (640, 480), distortion=distortion)


def test_inconsistent_correspondence_cannot_be_observed_pose():
    points = projection()
    points[61] = [600.0, 20.0]
    with pytest.raises(ValueError):
        estimate_head_pose(points, (640, 480))


def test_gimbal_lock_is_unknown():
    with pytest.raises(ValueError):
        estimate_head_pose(projection(90), (640, 480))


@pytest.mark.parametrize("yaw", [45.0, -45.0, 60.0])
def test_actual_distraction_streak_can_reach_existing_threshold(monitor, yaw):
    points = projection(yaw)
    for _ in range(31):
        report = monitor.detect_distraction(points, frame_size=(640, 480))
    assert report["status"] == "DISTRACTED"
    assert report["frames"] == 31 and report["is_distracted"] is True


def test_actual_failed_observation_resets_streak_instead_of_focused(monitor):
    points = projection(45)
    for _ in range(30):
        monitor.detect_distraction(points, frame_size=(640, 480))
    failed = monitor.detect_distraction(
        np.full((468, 2), np.nan), frame_size=(640, 480)
    )
    assert failed["status"] == "UNKNOWN" and monitor.distraction_frames == 0
    resumed = monitor.detect_distraction(points, frame_size=(640, 480))
    assert resumed["frames"] == 1 and resumed["status"] == "FOCUSED"
    missing = monitor.detect_distraction(points)
    assert missing["status"] == "UNKNOWN" and monitor.distraction_frames == 0


def feed(monitor, points, size=(640, 480), face=True):
    width, height = size
    landmarks = [
        SimpleNamespace(x=float(p[0] / width), y=float(p[1] / height)) for p in points
    ]
    output = SimpleNamespace(
        multi_face_landmarks=[SimpleNamespace(landmark=landmarks)] if face else []
    )
    monitor.face_mesh = SimpleNamespace(process=lambda rgb: output)
    return monitor.process_frame(np.zeros((height, width, 3), dtype=np.uint8))


def test_actual_frame_preserves_subpixel_pose_and_supplies_width_height(monitor):
    points = projection(45, size=(960, 540))
    for _ in range(31):
        report = feed(monitor, points, size=(960, 540))
    assert report["distraction"]["head_pose"]["yaw"] == pytest.approx(45.0, abs=1e-6)
    assert report["distraction"]["status"] == "DISTRACTED"
    assert report["overall_status"] == "CRITICAL"
    assert json.loads(monitor.redis.get("vision:latest")) == report
    json.dumps(report, allow_nan=False)


def test_actual_no_face_replaces_stale_safe_observation_and_resets(monitor):
    monitor.distraction_frames = 31
    monitor.eye_closed_frames = 21
    monitor.redis.set("vision:latest", json.dumps({"overall_status": "SAFE"}))
    report = feed(monitor, projection(), face=False)
    assert (
        report["status"] == "NO_FACE_DETECTED" and report["overall_status"] == "UNKNOWN"
    )
    assert monitor.get_alert(report)["level"] == "UNKNOWN"
    assert monitor.distraction_frames == 0 and monitor.eye_closed_frames == 0
    assert json.loads(monitor.redis.get("vision:latest")) == report


@pytest.mark.parametrize(
    "frame",
    [
        None,
        np.zeros((0, 10, 3), dtype=np.uint8),
        np.zeros((10, 10, 3)),
        np.zeros((10, 10, 4), dtype=np.uint8),
    ],
)
def test_actual_invalid_frame_has_complete_unknown_report(monitor, frame):
    report = monitor.process_frame(frame)
    assert report["status"] == "ERROR" and report["overall_status"] == "UNKNOWN"
    assert monitor.get_alert(report)["level"] == "UNKNOWN"
    assert json.loads(monitor.redis.get("vision:latest")) == report


def test_unknown_alert_never_becomes_safe(monitor):
    assert monitor.get_alert({"overall_status": "UNKNOWN"})["level"] == "UNKNOWN"
    assert monitor.get_alert({})["level"] == "UNKNOWN"


def test_native_behind_camera_solution_is_not_a_valid_pose():
    objects = np.array(
        [
            [0.0, 0, 0],
            [0, 330, 65],
            [-225, -170, 135],
            [225, -170, 135],
            [-150, 150, 125],
            [150, 150, 125],
        ]
    )
    camera = np.array([[640.0, 0, 320], [0, 640.0, 240], [0, 0, 1.0]])
    image = cv2.projectPoints(
        objects, np.zeros(3), np.array([0.0, 0.0, -1500.0]), camera, np.zeros(4)
    )[0].reshape(6, 2)
    points = np.tile([320.0, 240.0], (468, 1))
    points[[1, 152, 33, 263, 61, 291]] = image
    with pytest.raises(ValueError, match="front"):
        estimate_head_pose(points, (640, 480))


def test_landmark_count_bound_is_rejected():
    with pytest.raises(ValueError):
        estimate_head_pose(np.zeros((1025, 2)), (640, 480))


def test_native_unavailable_cache_does_not_turn_failed_vision_safe(monitor):
    original = monitor.redis
    monitor.redis = redis.Redis(
        unix_socket_path="/private/tmp/no-vision-cache-17761.sock"
    )
    try:
        result = monitor.process_frame(None)
        assert result["overall_status"] == "UNKNOWN"
        assert monitor.get_alert(result)["level"] == "UNKNOWN"
        json.dumps(result, allow_nan=False)
    finally:
        monitor.redis.close()
        monitor.redis = original
