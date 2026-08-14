import unittest
import numpy as np
from freight_diffusion import ScoreBasedFreightDiffusionSimulator

class TestFreightDiffusion(unittest.TestCase):
    def setUp(self):
        self.simulator = ScoreBasedFreightDiffusionSimulator(total_steps=10)

    def test_score_vector_bounds(self):
        x = np.array([0.5, -0.5])
        score = self.simulator.score_function(x, 0.5)
        self.assertAlmostEqual(score[0], -1.0)
        self.assertAlmostEqual(score[1], 1.0)

    def test_reverse_generation(self):
        res = self.simulator.generate_synthetic_demands(num_samples=3)
        self.assertEqual(len(res["synthetic_origin_destination_coords"]), 3)
        self.assertEqual(res["generation_status"], "SUCCESS")

if __name__ == '__main__':
    unittest.main()
