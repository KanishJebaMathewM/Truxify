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

class TestSmpcFieldStrength(unittest.TestCase):
    def test_default_field_is_cryptographically_large(self):
        engine = ShamirSmpcEngine()
        # Field must be far larger than any brute-force range.
        self.assertGreater(engine.prime.bit_length(), 64)

    def test_t_minus_1_shares_do_not_reveal_secret(self):
        engine = ShamirSmpcEngine()
        secret = 12345678901234567890123456789
        shares = engine.split_secret(secret, k=3, n=5)

        # An attacker holding only t-1 = 2 shares must not recover the secret.
        attacker_shares = shares[:2]
        reconstructed = engine.reconstruct_secret(attacker_shares)
        self.assertNotEqual(reconstructed, secret)

if __name__ == '__main__':
    unittest.main()
