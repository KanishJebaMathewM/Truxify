import unittest
import numpy as np
from eco_driving_pirl import PhysicsInformedEcoDrivingPirlModel

class TestPirlEcoDriving(unittest.TestCase):
    def setUp(self):
        self.model = PhysicsInformedEcoDrivingPirlModel(vehicle_mass_kg=15000.0)

    def test_drag_force_calculation(self):
        drag = self.model.calculate_aerodynamic_drag_force(20.0) # 20 m/s (~72 km/h)
        self.assertGreater(drag, 0.0)
        self.assertLess(drag, 2000.0)

    def test_eco_action_evaluation(self):
        res = self.model.evaluate_eco_action_pirl(speed_kmh=60.0, slope_rad=0.05, target_accel_mps2=0.5)
        self.assertGreater(res["required_traction_force_newtons"], 0.0)
        self.assertLess(res["physics_informed_reward"], 0.0)

if __name__ == '__main__':
    unittest.main()
