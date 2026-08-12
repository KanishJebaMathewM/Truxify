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

if __name__ == '__main__':
    unittest.main()
