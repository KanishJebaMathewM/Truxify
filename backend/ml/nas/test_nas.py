import unittest
import numpy as np
from nas_pruner import DartsNasPruner

class TestNASPruner(unittest.TestCase):
    def setUp(self):
        self.pruner = DartsNasPruner(pruning_threshold=0.2)

    def test_channel_pruning(self):
        weights = np.array([0.05, 0.25, -0.01, 0.88, -0.4])
        pruned = self.pruner.prune_channel_weights(weights)
        self.assertEqual(pruned[0], 0.0)
        self.assertEqual(pruned[2], 0.0)
        self.assertEqual(pruned[3], 0.88)

    def test_pareto_frontier(self):
        weights = np.array([0.0, 0.5, 0.0, 0.8])
        res = self.pruner.evaluate_pareto_frontier(0.95, 45.0, weights)
        self.assertLess(res["accuracy_drop_pct"], 1.0)
        self.assertLess(res["pruned_latency_ms"], 45.0)

if __name__ == '__main__':
    unittest.main()
