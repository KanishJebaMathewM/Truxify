import unittest
import numpy as np
from tgcn_speed import TemporalGcnSpeedPredictor

class TestTGCN(unittest.TestCase):
    def setUp(self):
        self.model = TemporalGcnSpeedPredictor(num_nodes=3)

    def test_speed_forecasting(self):
        # 3 nodes x 10 historical time steps
        history = np.array([
            [55.0, 52.0, 50.0, 48.0, 45.0, 42.0, 40.0, 38.0, 35.0, 30.0],
            [60.0, 62.0, 65.0, 63.0, 61.0, 60.0, 58.0, 55.0, 52.0, 50.0],
            [25.0, 22.0, 20.0, 18.0, 15.0, 12.0, 10.0, 12.0, 15.0, 18.0]
        ])

        res = self.model.predict_speed_forecast(history)
        self.assertEqual(len(res["forecast_speeds_kmh"]), 3)
        self.assertTrue(res["congestion_alert"])

if __name__ == '__main__':
    unittest.main()
