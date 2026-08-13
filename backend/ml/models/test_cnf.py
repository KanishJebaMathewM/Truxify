import unittest
import numpy as np
from cnf_density import ContinuousNormalizingFlowDensityEstimator

class TestCNF(unittest.TestCase):
    def setUp(self):
        self.estimator = ContinuousNormalizingFlowDensityEstimator()

    def test_log_likelihood_computation(self):
        coords = np.array([[28.6139, 77.2090], [19.0760, 72.8777]])
        ll = self.estimator.log_likelihood(coords)
        self.assertLess(ll, 0.0)

    def test_density_prediction(self):
        coords_list = [[28.6139, 77.2090], [19.0760, 72.8777]]
        res = self.estimator.predict_congestion_density(coords_list)
        self.assertIn("congestion_level", res)
        self.assertGreater(res["estimated_density"], 0.0)

if __name__ == '__main__':
    unittest.main()
