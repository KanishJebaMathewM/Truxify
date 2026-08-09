import numpy as np

class PhysicsConstrainedLoss:
    """
    Physics-Informed Neural Network (PINN) Loss Function.
    Enforces Newton's Second Law & non-negative vehicle axle degradation constraints.
    Loss = Data_Loss + lambda * Physics_Loss
    """
    def __init__(self, lambda_physics: float = 0.1):
        self.lambda_physics = lambda_physics

    def compute_physics_residual(self, speed: float, slope: float, mass: float, predicted_wear: float) -> float:
        # F_net = m * a + m * g * sin(theta)
        g = 9.81
        force = mass * (speed * 0.05) + mass * g * np.sin(slope)
        
        # Physical constraint: Wear must be non-negative and proportional to applied force
        expected_min_wear = max(0.0, force * 1e-6)
        physics_residual = max(0.0, expected_min_wear - predicted_wear) ** 2
        return float(physics_residual)

    def total_loss(self, data_mse: float, physics_residual: float) -> float:
        return data_mse + (self.lambda_physics * physics_residual)

physics_loss = PhysicsConstrainedLoss()
