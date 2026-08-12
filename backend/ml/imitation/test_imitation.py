import unittest
from behavioral_cloning import BehavioralCloningReRouter
from dataset_builder import TrajectoryDatasetBuilder

class TestImitationLearning(unittest.TestCase):
    def setUp(self):
        self.cloner = BehavioralCloningReRouter()
        self.builder = TrajectoryDatasetBuilder()

    def test_high_congestion_detour_recommendation(self):
        res = self.cloner.predict_detour_preference(speed=15.0, slope=0.01, congestion_level=0.9)
        self.assertTrue(res["recommend_detour"])
        self.assertEqual(res["suggested_route"], "Bypass Highway 44")

    def test_low_congestion_stay_on_main(self):
        res = self.cloner.predict_detour_preference(speed=65.0, slope=0.0, congestion_level=0.1)
        self.assertFalse(res["recommend_detour"])

    def test_dataset_builder(self):
        pairs = self.builder.build_state_action_pairs([{"speed": 50, "reroute_action": 1}])
        self.assertEqual(len(pairs), 1)

if __name__ == '__main__':
    unittest.main()
