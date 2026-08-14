"""Unit tests for backend/ml/models/ctrnn_imputer.py.

Run with: python3 -m pytest tests/test_ctrnn_imputer.py -v --no-header
"""
import numpy as np
from models.ctrnn_imputer import ContinuousTimeRnnImputer


class TestOdeStep:
    """Tests for the Euler ODE integration step."""

    def setup_method(self):
        self.imputer = ContinuousTimeRnnImputer(hidden_dim=4)

    def test_zero_dt_is_identity(self):
        """A zero time step must leave the hidden state unchanged."""
        h = np.array([1.0, -2.0, 0.5, 3.0])
        result = self.imputer.ode_step(h, 0.0)
        assert np.allclose(result, h)

    def test_matches_hand_computed_formula(self):
        """dh/dt = -h + tanh(W·h + b); h' = h + dh_dt * dt."""
        h = np.array([1.0, 0.0, 0.0, 0.0])
        dt = 0.5
        W = self.imputer.W
        bias = self.imputer.bias
        dh_dt = -h + np.tanh(W @ h + bias)
        expected = h + dh_dt * dt
        assert np.allclose(self.imputer.ode_step(h, dt), expected)

    def test_output_shape(self):
        """The hidden state shape must be preserved."""
        h = np.array([1.0, 2.0, 3.0, 4.0])
        assert self.imputer.ode_step(h, 0.1).shape == (4,)


class TestImputeMissingTelemetry:
    """Tests for the missing-telemetry interpolation."""

    def setup_method(self):
        self.imputer = ContinuousTimeRnnImputer(hidden_dim=4)

    def test_returns_tuple_of_two_floats(self):
        """The imputed value must be a (lat, lng) tuple of floats."""
        result = self.imputer.impute_missing_telemetry((12.97, 77.59), 60.0)
        assert isinstance(result, tuple)
        assert len(result) == 2
        assert all(isinstance(v, float) for v in result)

    def test_zero_seconds_returns_last_known(self):
        """A zero gap must return the last known coordinates unchanged."""
        coords = (12.97, 77.59)
        result = self.imputer.impute_missing_telemetry(coords, 0.0)
        assert np.isclose(result[0], coords[0])
        assert np.isclose(result[1], coords[1])

    def test_gap_pulls_coordinates_toward_origin(self):
        """The ODE dynamics decay the state toward zero, so a positive gap moves
        the imputed coordinates toward 0 while preserving the sign."""
        coords = (12.97, -77.59)
        result = self.imputer.impute_missing_telemetry(coords, 60.0)
        assert 0.0 < result[0] < coords[0]      # positive lat stays positive, smaller
        assert coords[1] < result[1] < 0.0      # negative lng stays negative, larger

    def test_longer_gap_moves_further(self):
        """A longer gap must move the imputed position further from the origin."""
        coords = (12.97, 77.59)
        short = self.imputer.impute_missing_telemetry(coords, 60.0)
        long_ = self.imputer.impute_missing_telemetry(coords, 600.0)
        short_dist = abs(short[0] - coords[0]) + abs(short[1] - coords[1])
        long_dist = abs(long_[0] - coords[0]) + abs(long_[1] - coords[1])
        assert long_dist > short_dist
