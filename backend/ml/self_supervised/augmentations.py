import numpy as np

class TrajectoryAugmenter:
    """
    Applies spatial jittering, point masking, and temporal scaling to GPS trajectories for SimCLR contrastive training.
    """
    @staticmethod
    def jitter(trajectory: np.ndarray, sigma: float = 0.001) -> np.ndarray:
        noise = np.random.normal(0, sigma, size=trajectory.shape)
        return trajectory + noise

    @staticmethod
    def mask_points(trajectory: np.ndarray, mask_ratio: float = 0.15) -> np.ndarray:
        aug = trajectory.copy()
        mask_len = int(len(aug) * mask_ratio)
        if mask_len > 0:
            indices = np.random.choice(len(aug), size=mask_len, replace=False)
            aug[indices] = 0.0
        return aug

    @staticmethod
    def time_warp(trajectory: np.ndarray, factor: float = 1.1) -> np.ndarray:
        return trajectory * factor
