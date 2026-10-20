"""Independent world-space projection controls for the actual camera helper."""

import numpy as np
import pytest
from nerf.camera import (
    CameraPose,
    create_frontal_poses,
    create_orbital_poses,
    create_spiral_poses,
)


@pytest.mark.parametrize(
    "position", [[0, 0, 2], [1, 2, 3], [-4, 0, 1], [1e308, 0, 0], [1e-300, 0, 0]]
)
def test_center_points_to_scene_and_basis_is_right_handed(position):
    pose = CameraPose(np.array(position, dtype=float), np.zeros(3))
    expected = -np.array(position, dtype=float)
    expected /= np.max(np.abs(expected))
    expected /= np.linalg.norm(expected)
    np.testing.assert_allclose(
        pose.get_ray_directions(60, (3, 3))[1, 1], expected, atol=1e-15
    )
    np.testing.assert_allclose(pose.rotation @ pose.rotation.T, np.eye(3), atol=1e-15)
    assert np.linalg.det(pose.rotation) == pytest.approx(1)


@pytest.mark.parametrize("shape", [(1, 1), (1, 5), (5, 1), (3, 7), (4, 6)])
def test_independent_pixel_projection(shape):
    # With this pose world coordinates equal camera coordinates; project rays
    # onto a unit-depth image plane and compare actual pixel-center locations.
    pose = CameraPose(np.array([0.0, 0.0, 2.0]), np.zeros(3), np.array([0.0, 1.0, 0.0]))
    rays = pose.get_ray_directions(90, shape)
    h, w = shape
    np.testing.assert_allclose(np.linalg.norm(rays, axis=-1), 1)
    projected = rays[..., :2] / -rays[..., 2:]
    for row in range(h):
        for col in range(w):
            np.testing.assert_allclose(
                projected[row, col],
                [
                    (col + 0.5 - w / 2) * 2 / w,
                    -(row + 0.5 - h / 2) * 2 / w,
                ],
                atol=1e-15,
            )


def test_rotated_world_ray_against_independent_cross_product_reference():
    rng = np.random.default_rng(41)
    for _ in range(80):
        pos, target, up = rng.normal(size=(3, 3))
        forward = target - pos
        forward /= np.linalg.norm(forward)
        right = np.cross(forward, up)
        right /= np.linalg.norm(right)
        vertical = np.cross(right, forward)
        # 90-degree horizontal FOV, pixel (3,3) of a 5x5 raster:
        # x=.4,y=-.4 at unit camera depth.
        expected = right * 0.4 - vertical * 0.4 + forward
        expected /= np.linalg.norm(expected)
        actual = CameraPose(pos, target, up).get_ray_directions(90, (5, 5))[3, 3]
        np.testing.assert_allclose(actual, expected, atol=1e-14)


def test_pose_and_ray_results_are_owned():
    pos, target, up = np.array([0.0, 0.0, 2.0]), np.zeros(3), np.array([0.0, 1.0, 0.0])
    pose = CameraPose(pos, target, up)
    expected = pose.get_rays(60, (3, 3))
    pos[:] = target[:] = up[:] = 99
    for field in ("position", "look_at", "up", "translation", "rotation"):
        getattr(pose, field)[:] = 100
    result = pose.get_rays(60, (3, 3))
    for key in result:
        np.testing.assert_array_equal(result[key], expected[key])
        result[key][:] = 42
    for key, value in pose.get_rays(60, (3, 3)).items():
        np.testing.assert_array_equal(value, expected[key])
    with pytest.raises(AttributeError):
        pose.position = np.zeros(3)


@pytest.mark.parametrize(
    "position,target,up",
    [
        ([0, 0, 0], [0, 0, 0], None),
        ([0, 0, 1], [0, 0, 0], [0, 0, 1]),
        ([0, 0, 1], [0, 0, 0], [0, 0, 0]),
        ([0, 0], [0, 0, 0], None),
        ([0, 0, np.inf], [0, 0, 0], None),
        ([0, 0, 1], [0, np.nan, 0], None),
        (["0", "0", "1"], [0, 0, 0], None),
        ([True] * 3, [0, 0, 0], None),
    ],
)
def test_invalid_pose_rejected(position, target, up):
    with pytest.raises(ValueError):
        CameraPose(position, target, up)


@pytest.mark.parametrize(
    "fov,size",
    [
        (0, (3, 3)),
        (180, (3, 3)),
        (np.nan, (3, 3)),
        (True, (3, 3)),
        ("60", (3, 3)),
        (60, (0, 3)),
        (60, (3, 1.5)),
        (60, (True, 3)),
        (60, (3,)),
        (60, None),
    ],
)
def test_invalid_intrinsics_rejected(fov, size):
    with pytest.raises(ValueError):
        CameraPose([0, 0, 2], [0, 0, 0]).get_rays(fov, size)


@pytest.mark.parametrize(
    "factory", [create_spiral_poses, create_orbital_poses, create_frontal_poses]
)
def test_path_center_orientation_and_ownership(factory):
    center = np.array([3.0, 4.0, 5.0])
    poses = factory(num_poses=11, radius=2, center=center)
    assert len(poses) == 11
    center[:] = 99
    for pose in poses:
        direction = np.array([3, 4, 5]) - pose.position
        direction /= np.linalg.norm(direction)
        rays = pose.get_rays(60, (1, 1))
        np.testing.assert_allclose(rays["directions"][0], direction, atol=1e-14)
        np.testing.assert_array_equal(rays["origins"][0], pose.position)
    poses[0].position[:] = 100
    assert not np.all(poses[1].position == 100)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"num_poses": 0},
        {"num_poses": True},
        {"num_poses": 1.5},
        {"radius": 0},
        {"radius": -1},
        {"radius": np.inf},
        {"center": [0, np.nan, 0]},
    ],
)
def test_invalid_path_rejected(kwargs):
    for factory in (create_spiral_poses, create_orbital_poses, create_frontal_poses):
        with pytest.raises(ValueError):
            factory(**kwargs)


def test_extreme_view_and_up_are_finite():
    pose = CameraPose([1e308, 0, 0], [-1e308, 0, 0], [0, 1e308, 0])
    np.testing.assert_allclose(pose.get_ray_directions(60, (1, 1))[0, 0], [-1, 0, 0])


def test_path_cannot_publish_collapsed_or_overflowed_geometry():
    with pytest.raises(ValueError):
        create_orbital_poses(2, 1, [1e308, 1e308, 1e308])
    with pytest.raises(ValueError):
        create_orbital_poses(2, 1e308, [1e308, 0, 0])
    with pytest.raises(ValueError):
        create_spiral_poses(height=np.nan)


def test_tiny_view_difference_beside_unchanged_huge_coordinate():
    pose = CameraPose([1e308, 0, 1e-300], [1e308, 0, 0])
    np.testing.assert_allclose(pose.get_ray_directions(60, (1, 1))[0, 0], [0, 0, -1])
