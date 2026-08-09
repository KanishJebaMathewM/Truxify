import unittest
import numpy as np
from ctrnn_imputer import ContinuousTimeRnnImputer

class TestCTRNN(unittest.TestCase):
    def setUp(self):
        self.imputer = ContinuousTimeRnnImputer()

    def test_continuous_imputation(self):
        last_coords = (28.6139, 77.2090) // Delhi coords
        imputed = self.imputer.impute_missing_telemetry(last_coords, dt_seconds=45.0)
        
        self.assertEqual(len(imputed), 2)
        self.assertAlmostEqual(imputed[0], 28.61, places=1)
        self.assertAlmostEqual(imputed[1], 77.20, places=1)

if __name__ == '__main__':
    unittest.main()
