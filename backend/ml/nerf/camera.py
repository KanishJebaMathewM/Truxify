"""Owned pinhole poses: row-stored world axes, camera -Z, raster Y down."""

from numbers import Integral, Real

import numpy as np


def _vector(value, name):
    try:
        raw = np.asarray(value)
        if raw.shape != (3,) or raw.dtype.kind not in "iuf":
            raise ValueError
        result = raw.astype(float, copy=True)
        if not np.isfinite(result).all():
            raise ValueError
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"{name} must be a finite real three-vector") from exc
    return result


def _unit(vector, name):
    scale = np.max(np.abs(vector))
    if scale == 0 or not np.isfinite(scale):
        raise ValueError(f"{name} must be nonzero and representable")
    scaled = vector / scale
    return scaled / np.linalg.norm(scaled)


def _real(value, name, positive=False):
    if isinstance(value, (bool, np.bool_)) or not isinstance(value, Real):
        raise ValueError(f"{name} must be finite real")  # noqa: TRY004 - public admission contract
    try:
        result = float(value)
    except (ValueError, OverflowError) as exc:
        raise ValueError(f"{name} must be representable") from exc
    if not np.isfinite(result) or (positive and result <= 0):
        raise ValueError(f"{name} is outside its valid range")
    return result


def _count(value, name):
    if (
        isinstance(value, (bool, np.bool_))
        or not isinstance(value, Integral)
        or value <= 0
    ):
        raise ValueError(f"{name} must be a positive integer")
    return int(value)


class CameraPose:
    """Immutable public pose snapshots with a consistent camera-to-world basis."""

    def __init__(self, position, look_at, up=None):
        self._position = _vector(position, "position")
        self._look_at = _vector(look_at, "look_at")
        self._up = _vector([0, -1, 0] if up is None else up, "up")
        # Preserve tiny differences beside unchanged huge coordinates; only
        # rescale endpoints when their actual subtraction exceeds float range.
        with np.errstate(over="ignore", invalid="ignore"):
            backward = self._position - self._look_at
        if not np.isfinite(backward).all():
            scale = max(np.max(np.abs(self._position)), np.max(np.abs(self._look_at)))
            backward = self._position / scale - self._look_at / scale
        z_axis = _unit(backward, "viewing axis")
        up_axis = _unit(self._up, "up")
        x_axis = _unit(np.cross(up_axis, z_axis), "up/view cross product")
        y_axis = _unit(np.cross(z_axis, x_axis), "vertical axis")
        self._rotation = np.stack([x_axis, y_axis, z_axis])

    @property
    def position(self):
        return self._position.copy()

    @property
    def look_at(self):
        return self._look_at.copy()

    @property
    def up(self):
        return self._up.copy()

    @property
    def rotation(self):
        return self._rotation.copy()

    @property
    def translation(self):
        return self._position.copy()

    def get_ray_directions(self, fov, image_size):
        """Unit world rays at pixel centers; fov is horizontal degrees."""
        fov = _real(fov, "fov")
        if not 0 < fov < 180:
            raise ValueError("fov must lie strictly between 0 and 180 degrees")
        try:
            h, w = image_size
        except (TypeError, ValueError) as exc:
            raise ValueError("image_size must contain height and width") from exc
        h, w = _count(h, "height"), _count(w, "width")
        tangent = np.tan(np.radians(fov) / 2)
        if tangent <= 0 or not np.isfinite(tangent):
            raise ValueError("fov must have representable pinhole intrinsics")
        with np.errstate(over="ignore", invalid="ignore"):
            x = ((np.arange(w, dtype=float) + 0.5) / w - 0.5) * (2 * tangent)
            y = -((np.arange(h, dtype=float) + 0.5) / w - h / (2 * w)) * (2 * tangent)
            xx, yy = np.meshgrid(x, y)
            directions = np.stack([xx, yy, -np.ones_like(xx)], axis=-1)
        if not np.isfinite(directions).all():
            raise ValueError("raster intrinsics are not representable")
        # Scale before norm to avoid squaring large finite camera coordinates.
        directions /= np.max(np.abs(directions), axis=-1, keepdims=True)
        directions /= np.linalg.norm(directions, axis=-1, keepdims=True)
        return directions @ self._rotation

    def get_rays(self, fov, image_size):
        directions = self.get_ray_directions(fov, image_size)
        origins = np.broadcast_to(self._position, directions.shape).copy()
        return {
            "origins": origins.reshape(-1, 3),
            "directions": directions.reshape(-1, 3),
            "camera_matrix": self.rotation,
            "position": self.position,
        }


def _path(num_poses, radius, center, height, kind):
    num_poses = _count(num_poses, "num_poses")
    radius = _real(radius, "radius", positive=True)
    center = _vector([0, 0, 0] if center is None else center, "center")
    height = _real(height, "height")
    poses = []
    for i in range(num_poses):
        phase = i / num_poses
        theta = 2 * np.pi * phase
        if kind == "frontal":
            offset = np.array([radius * (phase - 0.5), 0, radius])
        else:
            offset = np.array(
                [
                    radius * np.cos(theta),
                    height * (phase - 0.5) if kind == "spiral" else 0,
                    radius * np.sin(theta),
                ]
            )
        with np.errstate(over="ignore", invalid="ignore"):
            position = center + offset
        poses.append(CameraPose(position, center))
    return poses


def create_spiral_poses(num_poses=30, radius=2.0, height=1.0, center=None):
    """Return complete owned spiral poses around center."""
    return _path(num_poses, radius, center, height, "spiral")


def create_orbital_poses(num_poses=30, radius=2.0, center=None):
    """Return complete owned orbital poses around center."""
    return _path(num_poses, radius, center, 0, "orbital")


def create_frontal_poses(num_poses=10, radius=2.0, center=None):
    """Return complete owned frontal poses looking toward center."""
    return _path(num_poses, radius, center, 0, "frontal")
