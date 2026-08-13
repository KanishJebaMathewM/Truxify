import unittest
import numpy as np
from mappo_fleet import MappoFleetBalancer

class TestMAPPO(unittest.TestCase):
    def setUp(self):
        self.balancer = MappoFleetBalancer(num_agents=3, state_dim=4)

    def test_cooperative_dispatch(self):
        # State: [demand_level, available_trucks, average_toll_cost, signal_status]
        state = np.array([0.9, 0.2, 0.4, 0.1])
        res = self.balancer.compute_cooperative_actions(state)
        
        self.assertEqual(len(res["agent_selection_probabilities"]), 3)
        self.assertIn("optimal_dispatch_agent_id", res)
        self.assertGreater(res["critic_state_value"], 0.0)

    def test_stable_softmax_large_logits(self):
        # Large-magnitude logits previously overflowed np.exp -> NaN -> argmax=0,
        # collapsing the fleet to a fixed agent regardless of state.
        state = np.array([1e3, -1e3, 5e2, -5e2])
        res = self.balancer.compute_cooperative_actions(state)

        probs = np.array(res["agent_selection_probabilities"])
        self.assertTrue(np.all(np.isfinite(probs)), "softmax probs must be finite")
        self.assertLess(abs(float(probs.sum()) - 1.0), 1e-3)

        # Softmax is shift-invariant, so the selected agent must equal the
        # argmax of the raw logits (this fails with the old NaN/argmax=0 path).
        logits = state @ self.balancer.actor_weights
        expected = int(np.argmax(logits))
        self.assertEqual(res["optimal_dispatch_agent_id"], expected)
        self.assertIn(res["optimal_dispatch_agent_id"], range(3))

if __name__ == '__main__':
    unittest.main()
