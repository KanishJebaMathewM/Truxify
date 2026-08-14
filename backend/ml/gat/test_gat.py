import unittest
from dataset_loader import HighwayGraphDatasetLoader
from gat_congestion import GraphAttentionNetworkCongestionModel

class TestGATCongestion(unittest.TestCase):
    def setUp(self):
        self.loader = HighwayGraphDatasetLoader()
        self.model = GraphAttentionNetworkCongestionModel()

    def test_graph_dataset_loading(self):
        graph = self.loader.load_highway_graph()
        self.assertEqual(graph["num_nodes"], 5)
        self.assertEqual(graph["node_features"].shape, (5, 3))

    def test_gat_bottleneck_prediction(self):
        graph = self.loader.load_highway_graph()
        preds = self.model.predict_bottleneck_delays(graph["node_features"])
        self.assertEqual(len(preds), 5)
        
        # Node 1 is congested toll plaza (high density & wait time)
        self.assertTrue(preds[1]["is_bottleneck_detected"])

if __name__ == '__main__':
    unittest.main()
