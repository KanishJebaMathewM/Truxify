import unittest
import numpy as np
import torch
from patch_tst import PatchTSTPriceForecaster
from model import DemandForecastTransformer, TrafficForecastTransformer, PriceForecastTransformer

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

class TestForecastTransformersSmoke(unittest.TestCase):
    def test_demand_forward(self):
        model = DemandForecastTransformer()
        out = model(torch.randn(1, 72, 8))
        self.assertEqual(tuple(out.shape), (1, 24))

    def test_traffic_forward(self):
        model = TrafficForecastTransformer()
        out = model(torch.randn(1, 48, 5))
        self.assertEqual(tuple(out.shape), (1, 12))

    def test_price_forward(self):
        model = PriceForecastTransformer()
        out = model(torch.randn(1, 96, 6))
        self.assertEqual(tuple(out.shape), (1, 24))

class TestForecastTransformersForward(unittest.TestCase):
    def test_traffic_forecast_forward(self):
        model = TrafficForecastTransformer()
        x = torch.randn(1, 48, 5)
        out = model(x)
        self.assertEqual(out.shape, (1, 12))

    def test_price_forecast_forward(self):
        model = PriceForecastTransformer()
        x = torch.randn(1, 96, 6)
        out = model(x)
        self.assertEqual(out.shape, (1, 24))

    def test_traffic_forecast_batch_forward(self):
        model = TrafficForecastTransformer()
        x = torch.randn(8, 48, 5)
        out = model(x)
        self.assertEqual(out.shape, (8, 12))

    def test_price_forecast_batch_forward(self):
        model = PriceForecastTransformer()
        x = torch.randn(8, 96, 6)
        out = model(x)
        self.assertEqual(out.shape, (8, 24))

if __name__ == '__main__':
    unittest.main()
