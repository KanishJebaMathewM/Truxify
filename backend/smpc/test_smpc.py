import unittest
from smpc_node import ShamirSmpcEngine

class TestSmpc(unittest.TestCase):
    def setUp(self):
        self.engine = ShamirSmpcEngine(prime=2087)

    def test_secret_reconstruction(self):
        revenue_secret = 1250 # 1250 kINR revenue
        shares = self.engine.split_secret(revenue_secret, k=3, n=5)
        self.assertEqual(len(shares), 5)

        # Reconstruct using threshold subset of 3 shares
        subset = shares[:3]
        reconstructed = self.engine.reconstruct_secret(subset)
        self.assertEqual(reconstructed, revenue_secret)

if __name__ == '__main__':
    unittest.main()
