import unittest
import numpy as np
from ntru_signer import NtruLatticeEncryptor

class TestNtruPqc(unittest.TestCase):
    def setUp(self):
        self.encryptor = NtruLatticeEncryptor(N=128, q=512)

    def test_lattice_encryption(self):
        # Lat/Lng array coordinates
        payload = np.array([28.6139, 77.2090])
        res = self.encryptor.encrypt_telemetry_payload(payload)

        self.assertEqual(len(res["ciphertext_poly"]), 128)
        self.assertEqual(res["q"], 512)

if __name__ == '__main__':
    unittest.main()
