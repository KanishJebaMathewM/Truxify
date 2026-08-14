import numpy as np

class ScoreBasedFreightDiffusionSimulator:
    """
    Score-Based Generative Diffusion Model (VPSDE) for synthetic origin-destination
    freight demand flow generation. Used for dynamic simulator training.
    """
    def __init__(self, step_size: float = 0.01, total_steps: int = 100):
        self.step_size = step_size
        self.total_steps = total_steps
        # Drift coefficient mapping
        self.drift_factor = 0.15

    def score_function(self, x: np.ndarray, t: float) -> np.ndarray:
        """Score function representation (gradient of dynamic log density)."""
        return -x / (t + 1e-4)

    def sample_reverse_sde(self, starting_noise: np.ndarray) -> np.ndarray:
        """Simulates reverse stochastic differential equation trajectories (denoising)."""
        x = starting_noise.copy()
        
        for step in range(self.total_steps, 0, -1):
            t = step / self.total_steps
            score = self.score_function(x, t)
            
            # Predictor step
            drift = -self.drift_factor * x * self.step_size
            noise = np.random.normal(0, np.sqrt(self.step_size), size=x.shape)
            x = x + drift + (score * self.step_size) + (noise * 0.05)

        return x

    def generate_synthetic_demands(self, num_samples: int = 5) -> dict:
        noise = np.random.normal(0, 1.0, size=(num_samples, 2))
        synthetic_coords = self.sample_reverse_sde(noise)
        
        return {
            "num_samples": num_samples,
            "synthetic_origin_destination_coords": [
                [round(float(coord[0]) * 10.0 + 28.0, 4), round(float(coord[1]) * 10.0 + 77.0, 4)]
                for coord in synthetic_coords
            ],
            "generation_status": "SUCCESS"
        }

diffusion_simulator = ScoreBasedFreightDiffusionSimulator()
