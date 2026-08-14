"""Unit tests for backend/ml/anomaly/differential_privacy.py.

Run with: python3 -m pytest tests/test_differential_privacy.py -v --no-header
"""
import numpy as np
from anomaly.differential_privacy import DifferentialPrivacyEngine


class TestLaplaceNoise:
    """Tests for the Laplace mechanism."""

    def setup_method(self):
        self.engine = DifferentialPrivacyEngine(epsilon=1.0, delta=1e-5)

    def test_shape_is_preserved(self):
        """The noisy grid must match the input shape."""
        grid = np.zeros((5, 5))
        noisy = self.engine.add_laplace_noise(grid, sensitivity=1.0)
        assert noisy.shape == grid.shape

    def test_lower_epsilon_adds_more_noise(self):
        """A smaller epsilon must increase the noise scale and spread."""
        grid = np.zeros((2000,))
        engine_low = DifferentialPrivacyEngine(epsilon=0.1)
        engine_high = DifferentialPrivacyEngine(epsilon=10.0)
        spread_low = np.std(engine_low.add_laplace_noise(grid, 1.0))
        spread_high = np.std(engine_high.add_laplace_noise(grid, 1.0))
        assert spread_low > spread_high

    def test_noisy_grid_is_non_negative(self):
        """The clipped output must never contain negatives."""
        grid = np.zeros((100,))
        noisy = self.engine.add_laplace_noise(grid, sensitivity=1.0)
        assert np.all(noisy >= 0.0)


class TestGaussianNoise:
    """Tests for the Gaussian mechanism."""

    def setup_method(self):
        self.engine = DifferentialPrivacyEngine(epsilon=1.0, delta=1e-5)

    def test_shape_is_preserved(self):
        """The noisy grid must match the input shape."""
        grid = np.ones((4, 4))
        noisy = self.engine.add_gaussian_noise(grid, sensitivity=1.0)
        assert noisy.shape == grid.shape

    def test_lower_epsilon_increases_noise_spread(self):
        """A smaller epsilon must increase the Gaussian noise scale."""
        grid = np.zeros((2000,))
        engine_low = DifferentialPrivacyEngine(epsilon=0.1)
        engine_high = DifferentialPrivacyEngine(epsilon=10.0)
        spread_low = np.std(engine_low.add_gaussian_noise(grid, 1.0))
        spread_high = np.std(engine_high.add_gaussian_noise(grid, 1.0))
        assert spread_low > spread_high

    def test_noisy_grid_is_non_negative(self):
        """The clipped output must never contain negatives."""
        grid = np.zeros((100,))
        noisy = self.engine.add_gaussian_noise(grid, sensitivity=1.0)
        assert np.all(noisy >= 0.0)

    def test_scale_doubles_when_epsilon_halves(self):
        """The Gaussian scale is inversely proportional to epsilon, so halving
        epsilon must approximately double the measured noise spread."""
        grid = np.full((5000,), 1e6)  # large baseline so clipping is negligible
        engine_half = DifferentialPrivacyEngine(epsilon=0.5, delta=1e-5)
        spread_base = np.std(self.engine.add_gaussian_noise(grid, 1.0))
        spread_half = np.std(engine_half.add_gaussian_noise(grid, 1.0))
        assert spread_half > spread_base * 1.5
