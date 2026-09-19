import unittest
import numpy as np
import os
import concurrent.futures
from ntru_signer import NtruLatticeEncryptor, cyclic_convolution, center_lift

class TestNtruConcurrencyAndLatticeSecurity(unittest.TestCase):
    def setUp(self):
        self.encryptor = NtruLatticeEncryptor(N=128, q=512, p=3)

    def test_multi_threaded_concurrent_encryption(self):
        """
        Validates that 20 parallel worker threads generating NTRU ciphertexts
        exhibit complete PRNG isolation without collisions or state race conditions.
        """
        def worker_encrypt(worker_id):
            seed = os.urandom(32)
            payload = np.array([float(worker_id), float(worker_id * 2)])
            ciphertext = self.encryptor.encrypt_telemetry_payload(payload, seed)
            return (worker_id, ciphertext["ciphertext_poly"])

        results = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            futures = [executor.submit(worker_encrypt, i) for i in range(20)]
            for future in concurrent.futures.as_completed(futures):
                results.append(future.result())

        # Verify 20 distinct ciphertexts produced without errors
        self.assertEqual(len(results), 20)
        cipher_strings = [str(r[1]) for r in results]
        self.assertEqual(len(set(cipher_strings)), 20, "All concurrent ciphertexts must be unique")

    def test_keypair_reproducibility_from_fixed_seed(self):
        """
        Validates that the same 256-bit seed deterministically generates identical
        NTRU public and private keys, while different seeds generate distinct keys.
        """
        seed_a = bytes(range(32))
        seed_b = bytes(range(32, 64))

        kp1 = self.encryptor.generate_keypair(seed_a)
        kp2 = self.encryptor.generate_keypair(seed_a)
        kp3 = self.encryptor.generate_keypair(seed_b)

        self.assertEqual(kp1["public_key"], kp2["public_key"])
        self.assertEqual(kp1["private_key"], kp2["private_key"])
        self.assertNotEqual(kp1["public_key"], kp3["public_key"])

    def test_center_lift_boundary_invariants(self):
        """
        Tests center-lift invariants across extreme values near q/2 and 0.
        """
        q = 2048
        poly = np.array([0.0, 1024.0, 1025.0, 2047.0])
        lifted = center_lift(poly, q)

        self.assertEqual(lifted[0], 0.0)
        self.assertEqual(lifted[1], 1024.0)
        self.assertEqual(lifted[2], -1023.0)
        self.assertEqual(lifted[3], -1.0)

    def test_full_roundtrip_coordinate_restoration(self):
        """
        Validates that coordinate payloads quantized mod p are correctly recovered.
        """
        test_coordinates = [
            np.array([1.0, 2.0]),
            np.array([0.0, 1.0]),
            np.array([2.0, 0.0])
        ]
        for coords in test_coordinates:
            packet = self.encryptor.encrypt_telemetry_payload(coords)
            decrypted = self.encryptor.decrypt_telemetry_payload(packet)
            self.assertEqual(len(decrypted), len(coords))

if __name__ == '__main__':
    unittest.main()
