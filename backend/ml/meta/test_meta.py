import unittest
import numpy as np
from meta_pricing import MamlBilevelPricingOptimizer

class TestMamlMetaPricing(unittest.TestCase):
    def setUp(self):
        self.optimizer = MamlBilevelPricingOptimizer()

    def test_inner_loop_adaptation(self):
        support_x = np.array([[100.0, 10.0, 5.0], [50.0, 5.0, 2.5]])
        support_y = np.array([285.0, 142.5])

        adapted = self.optimizer.inner_loop_adapt(support_x, support_y)
        self.assertEqual(len(adapted), 3)

    def test_few_shot_fare_prediction(self):
        support_x = np.array([[100.0, 10.0, 5.0], [50.0, 5.0, 2.5]])
        support_y = np.array([285.0, 142.5])

        res = self.optimizer.predict_adapted_fare(120.0, 12.0, 6.0, support_x, support_y)
        self.assertTrue(res["few_shot_adapted"])
        self.assertGreater(res["predicted_fare_inr"], 100.0)

if __name__ == '__main__':
    unittest.main()
