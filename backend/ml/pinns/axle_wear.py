import numpy as np
from physics_loss import physics_loss

class AxleWearPinnEstimator:
    """
    Physics-Informed Neural Network Estimator for Truck Axle Stress and Tire Wear.
    """
    def __init__(self, weights: np.ndarray = None):
        self.weights = weights if weights is not None else np.array([0.005, 0.002, 0.0001])
        self.bias = 0.01

    def predict_wear(self, speed: float, elevation_slope: float, total_weight_kg: float) -> dict:
        features = np.array([speed, elevation_slope, total_weight_kg])
        raw_wear = float(np.dot(features, self.weights) + self.bias)
        
        # Enforce PINN non-negativity constraint
        constrained_wear = max(0.0, raw_wear)
        residual = physics_loss.compute_physics_residual(speed, elevation_slope, total_weight_kg, constrained_wear)

        return {
            "predicted_wear_mm": round(constrained_wear, 4),
            "physics_residual": round(residual, 6),
            "is_physically_valid": residual < 1e-4
        }

pinn_estimator = AxleWearPinnEstimator()
