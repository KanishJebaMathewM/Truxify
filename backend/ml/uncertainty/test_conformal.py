import math
import unittest

from conformal_eta import ConformalEtaEstimator


class TestConformalEta(unittest.TestCase):
    def setUp(self):
        self.estimator = ConformalEtaEstimator(alpha=0.05)

    def test_q_hat_quantile_calculation(self):
        # Six residuals cannot support a finite 95% split-conformal interval.
        self.assertTrue(math.isinf(self.estimator.calibrate_interval_q_hat()))

    def test_eta_bounds(self):
        res = self.estimator.predict_conformal_eta_bounds(60.0)
        self.assertEqual(res["lower_bound_eta_minutes"], 0.0)
        self.assertIsNone(res["upper_bound_eta_minutes"])
        self.assertIsNone(res["conformal_q_hat_margin"])
        self.assertTrue(res["interval_unbounded"])
        self.assertEqual(res["coverage_guarantee_pct"], 95.0)
        self.assertEqual(res["calibration_source"], "demonstration")


if __name__ == "__main__":
    unittest.main()
