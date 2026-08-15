import unittest

from kyber import KyberKEM


class TestKyberKEMDecapsulateUsesSecretKey(unittest.TestCase):
    def setUp(self):
        self.kem = KyberKEM()

    def test_decapsulate_recovers_encapsulated_shared_secret(self):
        pk, sk = self.kem.keygen()
        ciphertext, shared_secret = self.kem.encapsulate(pk)
        self.assertEqual(self.kem.decapsulate(ciphertext, sk), shared_secret)

    def test_decapsulate_with_wrong_secret_key_differs(self):
        pk, sk = self.kem.keygen()
        ciphertext, shared_secret = self.kem.encapsulate(pk)

        _, sk_other = self.kem.keygen()
        self.assertNotEqual(self.kem.decapsulate(ciphertext, sk_other), shared_secret)

    def test_shared_secret_not_derivable_from_public_key_and_ciphertext(self):
        # A holder of only the public key and ciphertext must not be able to
        # derive the shared secret, since decapsulation requires the secret key.
        import hashlib
        pk, sk = self.kem.keygen()
        ct, shared_secret = self.kem.encapsulate(pk)
        ct_bytes = hashlib.sha256(
            b"".join(int(x).to_bytes(8, 'little', signed=True) for x in ct['u'].flatten())
            + b"".join(int(x).to_bytes(8, 'little', signed=True) for x in ct['v'].flatten())
        ).digest()
        self.assertNotEqual(shared_secret, hashlib.sha256(pk['rho'] + ct_bytes).digest()[:32])


if __name__ == '__main__':
    unittest.main()
