import unittest
import numpy as np
from patch_tst import PatchTSTPriceForecaster

class TestPatchTST(unittest.TestCase):
    def setUp(self):
        self.model = PatchTSTPriceForecaster(patch_len=4, stride=2)

    def test_patch_creation(self):
        series = np.array([90.0, 91.5, 92.0, 92.8, 93.5, 94.0, 94.2, 95.0])
        patches = self.model.create_patches(series)
        self.assertEqual(patches.shape[1], 4)

    def test_multi_day_forecasting(self):
        series = np.array([90.0, 91.5, 92.0, 92.8, 93.5, 94.0, 94.2, 95.0])
        res = self.model.forecast_next_days(series, forecast_horizon_days=7)
        self.assertEqual(len(res["forecasted_prices"]), 7)
        self.assertGreater(res["mean_expected_price"], 90.0)

if __name__ == '__main__':
    unittest.main()
