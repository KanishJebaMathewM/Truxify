import unittest
import numpy as np
from augmentations import TrajectoryAugmenter
from contrastive_fraud import SimCLRContrastiveFraudDetector

class TestContrastiveFraud(unittest.TestCase):
    def setUp(self):
        self.augmenter = TrajectoryAugmenter()
        self.detector = SimCLRContrastiveFraudDetector()

    def test_augmentations(self):
        traj = np.array([[28.5, 77.1], [28.6, 77.2], [28.7, 77.3]])
        jittered = self.augmenter.jitter(traj)
        self.assertEqual(jittered.shape, traj.shape)

        masked = self.augmenter.mask_points(traj, mask_ratio=0.33)
        self.assertEqual(masked.shape, traj.shape)

    def test_anomaly_score_computation(self):
        normal_traj = np.ones((10, 2))
        score = self.detector.compute_anomaly_score(normal_traj)
        self.assertGreaterEqual(score, 0.0)
        self.assertLessEqual(score, 1.0)

if __name__ == '__main__':
    unittest.main()
