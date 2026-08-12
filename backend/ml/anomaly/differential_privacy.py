import numpy as np

class DifferentialPrivacyEngine:
    """
    Applies Laplace & Gaussian Differential Privacy noise (epsilon, delta) to spatial density heatmaps.
    """
    def __init__(self, epsilon: float = 1.0, delta: float = 1e-5):
        self.epsilon = epsilon
        self.delta = delta

    def add_laplace_noise(self, density_grid: np.ndarray, sensitivity: float = 1.0) -> np.ndarray:
        """Injects Laplace noise scaled by sensitivity / epsilon."""
        scale = sensitivity / self.epsilon
        noise = np.random.laplace(0, scale, size=density_grid.shape)
        noisy_grid = density_grid + noise
        return np.clip(noisy_grid, 0, None) # Ensure non-negative counts

    def add_gaussian_noise(self, density_grid: np.ndarray, sensitivity: float = 1.0) -> np.ndarray:
        """Injects Gaussian noise for (epsilon, delta)-DP."""
        sigma = np.sqrt(2 * np.log(1.25 / self.delta)) * (sensitivity / self.epsilon)
        noise = np.random.normal(0, sigma, size=density_grid.shape)
        noisy_grid = density_grid + noise
        return np.clip(noisy_grid, 0, None)

dp_engine = DifferentialPrivacyEngine(epsilon=0.5)
