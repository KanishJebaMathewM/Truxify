import unittest
import numpy as np
from differential_privacy import DifferentialPrivacyEngine

class TestDifferentialPrivacy(unittest.TestCase):
    def setUp(self):
        self.engine = DifferentialPrivacyEngine(epsilon=1.0)

    def test_laplace_noise(self):
        grid = np.array([[10, 20], [30, 40]], dtype=float)
        noisy = self.engine.add_laplace_noise(grid)
        self.assertEqual(noisy.shape, grid.shape)
        self.assertTrue(np.all(noisy >= 0))

    def test_gaussian_noise(self):
        grid = np.array([[5, 15], [25, 35]], dtype=float)
        noisy = self.engine.add_gaussian_noise(grid)
        self.assertEqual(noisy.shape, grid.shape)
        self.assertTrue(np.all(noisy >= 0))

if __name__ == '__main__':
    unittest.main()
