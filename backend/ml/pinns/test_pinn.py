import unittest
from axle_wear import AxleWearPinnEstimator
from physics_loss import PhysicsConstrainedLoss

class TestPINN(unittest.TestCase):
    def setUp(self):
        self.estimator = AxleWearPinnEstimator()
        self.loss = PhysicsConstrainedLoss()

    def test_physics_constrained_wear(self):
        res = self.estimator.predict_wear(speed=60.0, elevation_slope=0.05, total_weight_kg=15000.0)
        self.assertGreaterEqual(res["predicted_wear_mm"], 0.0)
        self.assertTrue(res["is_physically_valid"])

    def test_loss_computation(self):
        tot = self.loss.total_loss(data_mse=0.05, physics_residual=0.01)
        self.assertAlmostEqual(tot, 0.051)

if __name__ == '__main__':
    unittest.main()
