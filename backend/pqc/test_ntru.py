import unittest
import numpy as np
import os
from ntru_signer import NtruLatticeEncryptor
from entropy_validator import validate_seed_entropy, InsufficientEntropyError
from polynomial_utils import safe_polynomial_reduction

class TestNtruPqc(unittest.TestCase):
    def setUp(self):
        self.encryptor = NtruLatticeEncryptor(N=128, q=512)
        self.strong_seed = os.urandom(32)  # 256 bits of entropy
        self.weak_seed = b"0" * 16         # 128 bits, insufficient

    def test_lattice_encryption(self):
        # Lat/Lng array coordinates
        payload = np.array([28.6139, 77.2090])
        res = self.encryptor.encrypt_telemetry_payload(payload)

        self.assertEqual(len(res["ciphertext_poly"]), 128)
        self.assertEqual(res["q"], 512)
        self.assertTrue(all(0 <= c < 512 for c in res["ciphertext_poly"]))

    def test_lattice_encryption_rejects_weak_seed(self):
        payload = np.array([28.6139, 77.2090])
        with self.assertRaises(InsufficientEntropyError):
            self.encryptor.encrypt_telemetry_payload(payload, self.weak_seed)

    def test_keypair_generation_rejects_weak_seed(self):
        with self.assertRaises(InsufficientEntropyError):
            self.encryptor.generate_keypair(self.weak_seed)

    def test_keypair_generation_with_strong_seed(self):
        keypair = self.encryptor.generate_keypair(self.strong_seed)
        self.assertEqual(len(keypair["public_key"]), 128)
        self.assertEqual(len(keypair["private_key"]), 128)
        self.assertEqual(keypair["N"], 128)
        self.assertEqual(keypair["q"], 512)

    def test_polynomial_reduction_index_wrapping(self):
        # Test case where raw coefficients exceed N
        raw_coeffs = [1, 2, 3, 4, 5, 6]  # Length 6
        N = 4
        q = 10
        
        # Expected: 
        # index 0: 1 + 5 = 6
        # index 1: 2 + 6 = 8
        # index 2: 3
        # index 3: 4
        result = safe_polynomial_reduction(raw_coeffs, N, q)
        expected = np.array([6, 8, 3, 4], dtype=float)
        
        np.testing.assert_array_equal(result, expected)

if __name__ == '__main__':
    unittest.main()
