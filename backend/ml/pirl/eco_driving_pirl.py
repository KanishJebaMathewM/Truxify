import numpy as np

class PhysicsInformedEcoDrivingPirlModel:
    """
    Physics-Informed Reinforcement Learning (PIRL) Model.
    Optimizes truck acceleration guidance using powertrain physics equations.
    """
    def __init__(self, vehicle_mass_kg: float = 15000.0):
        self.mass = vehicle_mass_kg
        self.gravity = 9.81
        self.air_density = 1.2
        self.drag_coefficient = 0.65
        self.frontal_area = 8.5

    def calculate_aerodynamic_drag_force(self, speed_mps: float) -> float:
        """Aerodynamic drag equation: F_d = 0.5 * Cd * A * rho * v^2"""
        return float(0.5 * self.drag_coefficient * self.frontal_area * self.air_density * (speed_mps ** 2))

    def evaluate_eco_action_pirl(self, speed_kmh: float, slope_rad: float, target_accel_mps2: float) -> dict:
        speed_mps = speed_kmh / 3.6
        drag_force = self.calculate_aerodynamic_drag_force(speed_mps)
        gravity_resistance = self.mass * self.gravity * np.sin(slope_rad)
        
        # Physics-informed force requirements: F = m*a + F_drag + F_gravity
        required_traction_force_newtons = (self.mass * target_accel_mps2) + drag_force + gravity_resistance

        # Calculate reward penalizing traction force spikes (excessive fuel burns)
        action_reward = -0.0001 * required_traction_force_newtons - (target_accel_mps2 ** 2)

        return {
            "required_traction_force_newtons": round(required_traction_force_newtons, 2),
            "physics_informed_reward": round(action_reward, 4),
            "recommend_optimal_acceleration_mps2": round(target_accel_mps2, 2)
        }

pirl_driving_model = PhysicsInformedEcoDrivingPirlModel()
