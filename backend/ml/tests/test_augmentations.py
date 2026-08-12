"""Unit tests for backend/ml/self_supervised/augmentations.py.

Run with: python3 -m pytest tests/test_augmentations.py -v --no-header
"""
import numpy as np
from self_supervised.augmentations import TrajectoryAugmenter


class TestJitter:
    """Tests for spatial jittering."""

    def test_shape_is_preserved(self):
        """Jitter must not change the trajectory shape."""
        trajectory = np.zeros((10, 2))
        aug = TrajectoryAugmenter.jitter(trajectory, sigma=0.001)
        assert aug.shape == trajectory.shape

    def test_zero_sigma_is_identity(self):
        """A zero sigma must leave the trajectory unchanged."""
        trajectory = np.array([[1.0, 2.0], [3.0, 4.0]])
        aug = TrajectoryAugmenter.jitter(trajectory, sigma=0.0)
        assert np.array_equal(aug, trajectory)

    def test_positive_sigma_adds_noise(self):
        """A positive sigma must perturb the trajectory."""
        trajectory = np.zeros((100, 2))
        aug = TrajectoryAugmenter.jitter(trajectory, sigma=0.1)
        assert not np.array_equal(aug, trajectory)


class TestMaskPoints:
    """Tests for point masking."""

    def test_zero_ratio_is_identity(self):
        """A zero mask ratio must leave the trajectory unchanged."""
        trajectory = np.ones((10, 2))
        aug = TrajectoryAugmenter.mask_points(trajectory, mask_ratio=0.0)
        assert np.array_equal(aug, trajectory)

    def test_mask_zeroes_expected_count(self):
        """mask_ratio must zero out roughly mask_ratio * len points."""
        trajectory = np.ones((100, 2))
        aug = TrajectoryAugmenter.mask_points(trajectory, mask_ratio=0.2)
        masked_rows = np.sum(np.all(aug == 0.0, axis=1))
        assert masked_rows == 20

    def test_original_is_not_mutated(self):
        """Masking must operate on a copy, not the input."""
        trajectory = np.ones((10, 2))
        TrajectoryAugmenter.mask_points(trajectory, mask_ratio=0.5)
        assert np.all(trajectory == 1.0)


class TestTimeWarp:
    """Tests for temporal scaling."""

    def test_scales_by_factor(self):
        """time_warp must multiply the trajectory by the factor."""
        trajectory = np.array([[1.0, 2.0], [3.0, 4.0]])
        aug = TrajectoryAugmenter.time_warp(trajectory, factor=1.5)
        assert np.array_equal(aug, trajectory * 1.5)

    def test_factor_one_is_identity(self):
        """A factor of 1.0 must leave the trajectory unchanged."""
        trajectory = np.array([[1.0, 2.0], [3.0, 4.0]])
        aug = TrajectoryAugmenter.time_warp(trajectory, factor=1.0)
        assert np.array_equal(aug, trajectory)
