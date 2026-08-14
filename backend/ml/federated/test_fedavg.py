import unittest
import numpy as np
from fl_server import FederatedAveragingServer

class TestFederatedAveraging(unittest.TestCase):
    def setUp(self):
        self.server = FederatedAveragingServer(num_weights=4)

    def test_fedavg_aggregation(self):
        client1 = {"weights": np.array([1.0, 2.0, 3.0, 4.0]), "num_samples": 100}
        client2 = {"weights": np.array([2.0, 4.0, 6.0, 8.0]), "num_samples": 100}

        aggregated = self.server.aggregate_updates([client1, client2])
        expected = np.array([1.5, 3.0, 4.5, 6.0])
        
        np.testing.assert_array_almost_equal(aggregated, expected)

if __name__ == '__main__':
    unittest.main()
