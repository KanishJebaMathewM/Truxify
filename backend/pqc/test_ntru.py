import unittest
import numpy as np
import os
from ntru_signer import NtruLatticeEncryptor, cyclic_convolution, center_lift
from entropy_validator import validate_seed_entropy, InsufficientEntropyError
from polynomial_utils import safe_polynomial_reduction

class TestNtruPqc(unittest.TestCase):
    def setUp(self):
        self.encryptor = NtruLatticeEncryptor(N=128, q=512, p=3)
        self.strong_seed = os.urandom(32)  # 256 bits of entropy
        self.weak_seed = b"0" * 16         # 128 bits, insufficient

    def test_lattice_encryption(self):
        # Lat/Lng array coordinates
        payload = np.array([28.6139, 77.2090])
        res = self.encryptor.encrypt_telemetry_payload(payload)

        self.assertEqual(len(res["ciphertext_poly"]), 128)
        self.assertEqual(res["q"], 512)
        self.assertEqual(res["N"], 128)
        self.assertTrue(all(0 <= c < 512 for c in res["ciphertext_poly"]))

    def test_lattice_encryption_with_strong_seed(self):
        payload = np.array([37.7749, -122.4194])
        res = self.encryptor.encrypt_telemetry_payload(payload, self.strong_seed)
        self.assertEqual(len(res["ciphertext_poly"]), 128)
        self.assertEqual(res["payload_len"], 2)

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
        self.assertEqual(keypair["p"], 3)

    def test_prng_isolation_does_not_mutate_global_numpy_seed(self):
        # Seed global numpy
        np.random.seed(42)
        first_global_val = np.random.rand()

        # Run NTRU operations with isolated seeds
        np.random.seed(42)
        _ = self.encryptor.generate_keypair(self.strong_seed)
        _ = self.encryptor.encrypt_telemetry_payload([10.0, 20.0], self.strong_seed)
        subsequent_global_val = np.random.rand()

        # Global PRNG stream MUST be preserved identically because isolated generators were used
        self.assertEqual(first_global_val, subsequent_global_val)

    def test_polynomial_reduction_index_wrapping(self):
        raw_coeffs = [1, 2, 3, 4, 5, 6]  # Length 6
        N = 4
        q = 10
        result = safe_polynomial_reduction(raw_coeffs, N, q)
        expected = np.array([6, 8, 3, 4], dtype=float)
        np.testing.assert_array_equal(result, expected)

    def test_cyclic_convolution_mod_ring(self):
        # Ring Z[X]/(X^3 - 1)
        p1 = np.array([1, 2, 0], dtype=float)
        p2 = np.array([0, 1, 1], dtype=float)
        # p1 * p2 = (1 + 2X) * (X + X^2) = X + X^2 + 2X^2 + 2X^3 = 2 + X + 3X^2 mod (X^3 - 1)
        res = cyclic_convolution(p1, p2, N=3)
        expected = np.array([2.0, 1.0, 3.0])
        np.testing.assert_array_equal(res, expected)

    def test_center_lift_intervals(self):
        q = 512
        poly = np.array([10.0, 300.0, 500.0, 0.0])
        # 10 -> 10
        # 300 > 256 -> 300 - 512 = -212
        # 500 > 256 -> 500 - 512 = -12
        # 0 -> 0
        lifted = center_lift(poly, q)
        expected = np.array([10.0, -212.0, -12.0, 0.0])
        np.testing.assert_array_equal(lifted, expected)

    def test_lattice_decryption_pipeline(self):
        # Test decryption reconstruction
        payload = np.array([1.0, 2.0])
        enc = self.encryptor.encrypt_telemetry_payload(payload, self.strong_seed)
        dec = self.encryptor.decrypt_telemetry_payload(enc)

        self.assertEqual(len(dec), 2)
        # Decrypted coefficients should be bounded integers mod p
        self.assertTrue(all(0 <= int(v) < 3 for v in dec))

if __name__ == '__main__':
    unittest.main()
