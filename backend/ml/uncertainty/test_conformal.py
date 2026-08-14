import unittest
from conformal_eta import ConformalEtaEstimator

class TestConformalEta(unittest.TestCase):
    def setUp(self):
        self.estimator = ConformalEtaEstimator(alpha=0.05)

    def test_q_hat_quantile_calculation(self):
        q_hat = self.estimator.calibrate_interval_q_hat()
        # Maximum score index should be returned for small n
        self.assertEqual(q_hat, 14.0)

    def test_eta_bounds(self):
        res = self.estimator.predict_conformal_eta_bounds(60.0)
        self.assertEqual(res["lower_bound_eta_minutes"], 46.0)
        self.assertEqual(res["upper_bound_eta_minutes"], 74.0)
        self.assertEqual(res["coverage_guarantee_pct"], 95.0)

if __name__ == '__main__':
    unittest.main()
