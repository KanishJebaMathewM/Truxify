import ast
import hashlib
import os
import unittest

from kyber_relayer import Kyber1024Relayer

KYBER_RELAYER_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "kyber_relayer.py")
)

CONFLICT_MARKERS = ("<<<<<<<", "=======", ">>>>>>>")


class TestKyber1024Relayer(unittest.TestCase):
    def setUp(self):
        self.relayer = Kyber1024Relayer()

    def test_module_has_no_merge_conflict_markers(self):
        with open(KYBER_RELAYER_PATH, "r", encoding="utf-8") as fh:
            source = fh.read()

        for marker in CONFLICT_MARKERS:
            self.assertNotIn(marker, source)

    def test_module_uses_genuine_ml_kem_not_broken_hash_construction(self):
        with open(KYBER_RELAYER_PATH, "r", encoding="utf-8") as fh:
            source = fh.read()

        # Must parse cleanly (no leftover conflict markers / syntax breakage).
        ast.parse(source)

        # Genuine ML-KEM-1024 implementation must be present.
        self.assertIn("ML_KEM", source)

        # The broken hash-based KEM must be gone: the public key must not be a
        # pure function of a seed, and the ciphertext must not be a simple XOR
        # keystream derived solely from the public key.
        self.assertNotIn('"KYBER_PK_TAG"', source)
        self.assertNotIn("'KYBER_PK_TAG'", source)

    def test_keypair_generation(self):
        pk, sk = self.relayer.generate_keypair()
        self.assertEqual(len(pk), self.relayer.public_key_len)
        self.assertEqual(len(sk), self.relayer.secret_key_len)

    def test_encapsulate_decapsulate(self):
        pk, sk = self.relayer.generate_keypair()
        ct, ss1 = self.relayer.encapsulate(pk)
        self.assertEqual(len(ct), self.relayer.ciphertext_len)
        self.assertEqual(len(ss1), 32)

        ss2 = self.relayer.decapsulate(ct, sk)
        self.assertEqual(len(ss2), 32)
        self.assertEqual(ss1, ss2)

    def test_shared_secret_not_derivable_from_public_key_alone(self):
        pk, sk = self.relayer.generate_keypair()
        ct, ss = self.relayer.encapsulate(pk)

        # The old construction derived the encryption key and the shared
        # secret purely from the public key. With real ML-KEM-1024 those
        # derivations must not reproduce the shared secret.
        self.assertNotEqual(ss, hashlib.sha3_512(pk).digest()[:32])
        self.assertNotEqual(ss, hashlib.sha3_512(pk + ct).digest()[:32])
        self.assertNotEqual(ss, hashlib.sha3_512(ct).digest()[:32])

    def test_old_xor_ciphertext_attack_no_longer_recovers_shared_secret(self):
        pk, sk = self.relayer.generate_keypair()
        ct, ss = self.relayer.encapsulate(pk)

        # Previous scheme: message = ct_blob XOR SHA3-512(pk), then
        # shared_secret = SHA3-512(pk + message). A holder of only the public
        # key could perform this. It must fail against real ML-KEM ciphertext.
        recovered = bytes(a ^ b for a, b in zip(ct[:32], hashlib.sha3_512(pk).digest()[:32]))
        recovered_secret = hashlib.sha3_512(pk + recovered).digest()[:32]
        self.assertNotEqual(recovered_secret, ss)

    def test_decapsulation_with_wrong_secret_key_does_not_reveal_shared_secret(self):
        pk, sk = self.relayer.generate_keypair()
        ct, ss = self.relayer.encapsulate(pk)

        # A party holding a different keypair must not be able to recover the
        # shared secret from the same ciphertext.
        pk_other, sk_other = self.relayer.generate_keypair()
        wrong_ss = self.relayer.decapsulate(ct, sk_other)
        self.assertNotEqual(wrong_ss, ss)

    def test_invalid_lengths_raise(self):
        with self.assertRaises(ValueError):
            self.relayer.encapsulate(b"too-short")
        with self.assertRaises(ValueError):
            self.relayer.decapsulate(b"bad", b"bad")

if __name__ == '__main__':
    unittest.main()
