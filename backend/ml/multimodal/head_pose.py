"""Admitted synthetic-template head pose using native OpenCV geometry.

Camera coordinates: right/down/forward. Euler composition: Rz(roll) Ry(yaw)
Rx(pitch). Default template/intrinsics are approximations, not calibration.
"""

import math

import cv2
import numpy as np

LANDMARK_IDS = (1, 152, 33, 263, 61, 291)
TEMPLATE = np.array(
    [
        [0.0, 0.0, 0.0],
        [0.0, 330.0, 65.0],
        [-225.0, -170.0, 135.0],
        [225.0, -170.0, 135.0],
        [-150.0, 150.0, 125.0],
        [150.0, 150.0, 125.0],
    ],
    dtype=np.float64,
)
TEMPLATE.flags.writeable = False


def finite_array(value, shape=None):
    raw = np.asarray(value)
    if raw.dtype.kind not in "iuf" or (shape is not None and raw.shape != shape):
        raise ValueError("pose geometry requires complete real numeric arrays")
    with np.errstate(over="ignore", invalid="ignore"):
        owned = np.array(raw, dtype=np.float64, copy=True)
    if not np.isfinite(owned).all():
        raise ValueError("pose geometry must be finite binary64")
    return owned


def estimate_head_pose(landmarks, frame_size, camera_matrix=None, distortion=None):
    if (
        not isinstance(frame_size, (tuple, list))
        or len(frame_size) != 2
        or any(type(v) is not int or not 1 <= v <= 8192 for v in frame_size)
    ):
        raise ValueError("pose requires frame (width, height) integers in [1,8192]")
    width, height = frame_size
    raw_points = np.asarray(landmarks)
    if (
        raw_points.ndim != 2
        or raw_points.shape[1] != 2
        or not 292 <= raw_points.shape[0] <= 1024
    ):
        raise ValueError("pose requires a complete bounded [landmarks,2] matrix")
    points = finite_array(raw_points)
    if (
        np.any(points[:, 0] < -width)
        or np.any(points[:, 0] > 2 * width)
        or np.any(points[:, 1] < -height)
        or np.any(points[:, 1] > 2 * height)
    ):
        raise ValueError("landmark coordinates are outside the admitted frame vicinity")
    image = np.ascontiguousarray(points[list(LANDMARK_IDS)])
    if (
        np.unique(image, axis=0).shape[0] != 6
        or np.linalg.matrix_rank(image - image.mean(axis=0)) < 2
    ):
        raise ValueError("pose landmarks must span a nondegenerate image geometry")
    assumed = camera_matrix is None
    if assumed:
        focal = float(max(width, height))
        camera = np.array([[focal, 0, width / 2], [0, focal, height / 2], [0, 0, 1]])
    else:
        camera = finite_array(camera_matrix, (3, 3))
    if (
        camera[0, 0] <= 0
        or camera[1, 1] <= 0
        or camera[0, 1] != 0
        or camera[1, 0] != 0
        or not np.array_equal(camera[2], [0, 0, 1])
    ):
        raise ValueError(
            "camera requires positive focal lengths and canonical pinhole form"
        )
    if distortion is None:
        coefficients = np.zeros(4, dtype=np.float64)
    else:
        raw_distortion = np.asarray(distortion)
        if raw_distortion.ndim != 1 or raw_distortion.size not in (4, 5, 8, 12, 14):
            raise ValueError(
                "distortion requires a supported complete coefficient vector"
            )
        coefficients = finite_array(raw_distortion)
    try:
        success, rotation, translation = cv2.solvePnP(
            TEMPLATE, image, camera, coefficients, flags=cv2.SOLVEPNP_ITERATIVE
        )
        if (
            not success
            or not np.isfinite(rotation).all()
            or not np.isfinite(translation).all()
        ):
            raise ValueError("pose solver did not provide finite observations")
        matrix, _ = cv2.Rodrigues(rotation)
        transformed = TEMPLATE @ matrix.T + translation.reshape(1, 3)
        if not np.isfinite(transformed).all() or np.any(transformed[:, 2] <= 0):
            raise ValueError("pose requires all template points in front of the camera")
        projected, _ = cv2.projectPoints(
            TEMPLATE, rotation, translation, camera, coefficients
        )
    except cv2.error as exc:
        raise ValueError("native pose solver rejected geometry") from exc
    error = float(
        np.sqrt(np.mean(np.sum((projected.reshape(6, 2) - image) ** 2, axis=1)))
    )
    if not math.isfinite(error) or error > max(width, height) * 0.02:
        raise ValueError("pose reprojection exceeds the admitted residual")
    cosine = math.hypot(float(matrix[0, 0]), float(matrix[1, 0]))
    if cosine < 1e-6:
        raise ValueError("Euler pose is ambiguous at gimbal lock")
    yaw = math.degrees(math.atan2(-float(matrix[2, 0]), cosine))
    pitch = math.degrees(math.atan2(float(matrix[2, 1]), float(matrix[2, 2])))
    roll = math.degrees(math.atan2(float(matrix[1, 0]), float(matrix[0, 0])))
    return {
        "yaw": yaw,
        "pitch": pitch,
        "roll": roll,
        "reprojection_error_px": error,
        "camera_source": "assumed_pinhole" if assumed else "provided",
    }
