import unittest
import numpy as np
from gtn_logistics import GraphTransformerNetworkLogisticsEmbedder

class TestGTN(unittest.TestCase):
    def setUp(self):
        self.embedder = GraphTransformerNetworkLogisticsEmbedder(num_edge_types=4, embedding_dim=8)

    def test_metapath_multiplication(self):
        # 3x3 adjacency matrices for 4 edge relations
        # E.g.: driver-driver, driver-warehouse, driver-load, driver-corridor
        adjacencies = [
            np.eye(3) * 0.1,
            np.eye(3) * 0.2,
            np.eye(3) * 0.3,
            np.eye(3) * 0.4
        ]

        gtn_adj = self.embedder.compute_metapath_adjacencies(adjacencies)
        self.assertEqual(gtn_adj.shape, (3, 3))
        
        prob = self.embedder.predict_link_probabilities(adjacencies, 0, 0)
        self.assertGreater(prob, 0.4)

if __name__ == '__main__':
    unittest.main()
