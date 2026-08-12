"""Unit tests for backend/ml/nerf/nerf_inspector.py.

Run with: python3 -m pytest tests/test_nerf_inspector.py -v --no-header
"""
import numpy as np
import pytest
from nerf.nerf_inspector import NerfContainerDamageInspector


class TestSynthesizePointCloud:
    """Tests for the 3D point-cloud synthesis."""

    def setup_method(self):
        self.inspector = NerfContainerDamageInspector(volumetric_resolution=64)

    def test_requires_at_least_two_views(self):
        """Fewer than 2 views must raise ValueError."""
        with pytest.raises(ValueError):
            self.inspector.synthesize_3d_point_cloud(["hash1"])

    def test_returns_10_cubed_grid(self):
        """The voxel grid must be 10x10x10."""
        grid = self.inspector.synthesize_3d_point_cloud(["a", "b"])
        assert grid.shape == (10, 10, 10)

    def test_dent_voxel_is_present(self):
        """The simulated dent voxel at (2,5,3) must be the grid maximum."""
        grid = self.inspector.synthesize_3d_point_cloud(["a", "b", "c"])
        assert grid[2, 5, 3] == 0.85
        assert grid.max() == 0.85


class TestEvaluateContainerDamage:
    """Tests for the container damage evaluation."""

    def setup_method(self):
        self.inspector = NerfContainerDamageInspector()

    def test_returns_expected_keys(self):
        """The evaluation must expose the documented fields."""
        result = self.inspector.evaluate_container_damage(["a", "b"])
        assert set(result.keys()) == {
            "views_processed",
            "max_dent_depth_cm",
            "damaged_volume_cc",
            "damage_severity",
            "is_structural_damage_detected",
        }

    def test_views_processed_matches_input(self):
        """The views_processed field must equal the number of photo hashes."""
        result = self.inspector.evaluate_container_damage(["a", "b", "c"])
        assert result["views_processed"] == 3

    def test_damage_is_detected(self):
        """The simulated dent (0.85 voxel) must exceed the structural threshold."""
        result = self.inspector.evaluate_container_damage(["a", "b"])
        assert result["is_structural_damage_detected"] is True
        assert result["max_dent_depth_cm"] > 5.0
        assert result["damage_severity"] == "MODERATE"
