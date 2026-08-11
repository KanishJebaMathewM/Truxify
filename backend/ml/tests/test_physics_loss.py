"""Unit tests for backend/ml/pinns/physics_loss.py.

Run with: python3 -m pytest tests/test_physics_loss.py -v --no-header
"""
import math
from pinns.physics_loss import PhysicsConstrainedLoss


class TestComputePhysicsResidual:
    """Tests for the physics-constrained residual."""

    def setup_method(self):
        self.loss = PhysicsConstrainedLoss(lambda_physics=0.1)

    def test_zero_residual_when_wear_meets_expected_minimum(self):
        """Wear above the physical minimum must yield a zero residual."""
        # F = m*(speed*0.05) + m*g*sin(slope); expected_min_wear = F*1e-6
        speed, slope, mass = 60.0, 0.0, 10000.0
        force = mass * (speed * 0.05) + mass * 9.81 * math.sin(slope)
        expected_min_wear = max(0.0, force * 1e-6)
        residual = self.loss.compute_physics_residual(speed, slope, mass, expected_min_wear)
        assert residual == 0.0

    def test_positive_residual_when_wear_below_minimum(self):
        """Wear below the physical minimum must produce a squared residual."""
        speed, slope, mass = 60.0, 0.0, 10000.0
        residual = self.loss.compute_physics_residual(speed, slope, mass, 0.0)
        assert residual > 0.0

    def test_residual_is_squared(self):
        """The residual must be the squared gap between expected and predicted wear."""
        speed, slope, mass = 60.0, 0.0, 10000.0
        force = mass * (speed * 0.05) + mass * 9.81 * math.sin(slope)
        expected_min_wear = max(0.0, force * 1e-6)
        residual = self.loss.compute_physics_residual(speed, slope, mass, 0.0)
        assert math.isclose(residual, expected_min_wear ** 2, rel_tol=1e-9)

    def test_slope_increases_residual(self):
        """A positive slope increases the force, hence the expected minimum wear."""
        base = self.loss.compute_physics_residual(60.0, 0.0, 10000.0, 0.0)
        uphill = self.loss.compute_physics_residual(60.0, 0.3, 10000.0, 0.0)
        assert uphill > base


class TestTotalLoss:
    """Tests for the composite loss."""

    def test_combines_data_and_physics_terms(self):
        """total_loss = data_mse + lambda * physics_residual."""
        loss = PhysicsConstrainedLoss(lambda_physics=0.5)
        assert loss.total_loss(10.0, 4.0) == 12.0

    def test_default_lambda_is_0_1(self):
        """The default lambda scales the physics term by 0.1."""
        loss = PhysicsConstrainedLoss()
        assert loss.total_loss(10.0, 4.0) == 10.4

    def test_zero_physics_term_passes_data_loss_through(self):
        """A zero physics residual must not alter the data term."""
        loss = PhysicsConstrainedLoss(lambda_physics=2.0)
        assert loss.total_loss(7.5, 0.0) == 7.5
