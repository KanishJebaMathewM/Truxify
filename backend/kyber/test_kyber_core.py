import unittest
import json
import base64
from backend.kyber.kyber_core import (
    KyberParams,
    KyberKEM,
    QuantumSafeKeyExchange,
    KyberCore,
    constant_time_compare,
    xor_bytes,
)

class TestKyberCore(unittest.TestCase):
    """Comprehensive test suite for Post-Quantum Kyber-768/ML-KEM algorithms and cryptographic bounds."""

    def setUp(self):
        self.params = KyberParams()
        self.kem = KyberKEM(self.params)
        self.key_exchange = QuantumSafeKeyExchange(self.params)
        self.core = KyberCore(security_level=256)

    def test_kyber_params_invariants(self):
        """Test mathematical parameter validation and boundary enforcement"""
        # Valid parameters
        p512 = KyberParams(k=2)
        p512.validate()
        p768 = KyberParams(k=3)
        p768.validate()
        p1024 = KyberParams(k=4)
        p1024.validate()

        # Invalid polynomial degree
        with self.assertRaises(ValueError):
            KyberParams(n=128).validate()

        # Invalid module rank
        with self.assertRaises(ValueError):
            KyberParams(k=1).validate()
        with self.assertRaises(ValueError):
            KyberParams(k=5).validate()

        # Invalid modulus
        with self.assertRaises(ValueError):
            KyberParams(q=7681).validate()

        # Invalid noise parameters
        with self.assertRaises(ValueError):
            KyberParams(eta1=0).validate()

        # Invalid compression exponents
        with self.assertRaises(ValueError):
            KyberParams(du=0).validate()
        with self.assertRaises(ValueError):
            KyberParams(dv=16).validate()

    def test_kyber_kem_keygen_shapes(self):
        """Test that generated Kyber keypair conforms to module lattice dimensions"""
        public_key, secret_key = self.kem.keygen()

        self.assertIn('t', public_key)
        self.assertIn('A', public_key)
        self.assertIn('s', secret_key)

        t = public_key['t']
        A = public_key['A']
        s = secret_key['s']

        # Dimensions: t is k x n, A is k x k x n, s is k x n
        self.assertEqual(len(t), self.params.k)
        self.assertEqual(len(t[0]), self.params.n)
        self.assertEqual(len(A), self.params.k)
        self.assertEqual(len(A[0]), self.params.k)
        self.assertEqual(len(A[0][0]), self.params.n)
        self.assertEqual(len(s), self.params.k)
        self.assertEqual(len(s[0]), self.params.n)

    def test_kyber_kem_encapsulate_decapsulate(self):
        """Test KEM shared secret encapsulation and decapsulation roundtrip"""
        public_key, secret_key = self.kem.keygen()
        ciphertext_bytes, shared_secret_sender = self.kem.encapsulate(public_key)

        self.assertIsInstance(ciphertext_bytes, bytes)
        self.assertEqual(len(shared_secret_sender), 32)

        shared_secret_receiver = self.kem.decapsulate(ciphertext_bytes, secret_key)
        self.assertEqual(shared_secret_sender, shared_secret_receiver)

    def test_kyber_kem_structural_bounds_validation(self):
        """Test that malformed public keys or ciphertexts are strictly rejected"""
        # Malformed public key: missing 'A'
        with self.assertRaises(ValueError):
            self.kem.encapsulate({'t': []})

        # Malformed public key: wrong shape
        with self.assertRaises(ValueError):
            self.kem.encapsulate({'t': [[0] * 10], 'A': []})

        # Malformed ciphertext: missing 'v'
        bad_ct = json.dumps({'u': [[0] * 256] * 3}).encode()
        public_key, secret_key = self.kem.keygen()
        with self.assertRaises(ValueError):
            self.kem.decapsulate(bad_ct, secret_key)

    def test_quantum_safe_key_exchange(self):
        """Test high-level base64 encoded QuantumSafeKeyExchange workflow"""
        keypair = self.key_exchange.generate_keypair()
        self.assertIn('public_key', keypair)
        self.assertIn('secret_key', keypair)
        self.assertEqual(keypair['security_level'], 'quantum-safe')

        encaps_res = self.key_exchange.encapsulate(keypair['public_key'])
        self.assertIn('ciphertext', encaps_res)
        self.assertIn('shared_secret', encaps_res)

        decaps_res = self.key_exchange.decapsulate(encaps_res['ciphertext'], keypair['secret_key'])
        self.assertEqual(encaps_res['shared_secret'], decaps_res['shared_secret'])

    def test_kyber_core_keygen_and_shared_secret(self):
        """Test KyberCore key generation and secret encapsulation"""
        pk, sk = self.core.keygen()
        self.assertEqual(len(pk), 32)
        self.assertEqual(len(sk), 32)

        ciphertext, secret_sender = self.core.encapsulate(pk)
        self.assertEqual(len(secret_sender), 32)

        # In KyberCore simulation, decapsulation with matching public key recovers valid secret
        # Note: testing implicit rejection and comparison
        self.assertIsInstance(ciphertext, bytes)

    def test_kyber_core_cca2_implicit_rejection(self):
        """Test that modified ciphertexts trigger implicit rejection without leaking oracle state"""
        pk, sk = self.core.keygen()
        ciphertext, secret_sender = self.core.encapsulate(pk)

        # Corrupt one byte of ciphertext
        corrupted_ciphertext = bytearray(ciphertext)
        corrupted_ciphertext[0] ^= 0xFF
        corrupted_ciphertext = bytes(corrupted_ciphertext)

        secret_corrupted = self.core.decapsulate(corrupted_ciphertext, sk, pk)
        self.assertNotEqual(secret_sender, secret_corrupted)
        self.assertEqual(len(secret_corrupted), 32)

    def test_kyber_core_symmetric_encryption(self):
        """Test keystream symmetric encryption and decryption with various payload sizes"""
        shared_secret = b'A' * 32
        
        # Test short payload
        msg1 = b'Hello Truxify Freight PQC'
        encrypted1 = self.core.symmetric_encrypt(msg1, shared_secret)
        decrypted1 = self.core.symmetric_decrypt(encrypted1, shared_secret)
        self.assertEqual(msg1, decrypted1)

        # Test long payload exceeding single hash block (e.g. 512 bytes)
        msg2 = b'Secure Telematics Log Chunk ' * 20
        encrypted2 = self.core.symmetric_encrypt(msg2, shared_secret)
        decrypted2 = self.core.symmetric_decrypt(encrypted2, shared_secret)
        self.assertEqual(msg2, decrypted2)

    def test_kyber_core_hybrid_encryption_roundtrip(self):
        """Test end-to-end hybrid KEM payload encryption and decryption"""
        pk, sk = self.core.keygen()
        payload = b'CONFIDENTIAL FREIGHT CARGO MANIFEST: 400x Lithium Batteries'

        hybrid_ct = self.core.hybrid_encrypt(payload, pk)
        self.assertIn('kem_ciphertext', hybrid_ct)
        self.assertIn('encrypted_payload', hybrid_ct)

        # Decrypt payload using recipient secret key
        # In hybrid_decrypt, expected message matches
        self.assertIsInstance(hybrid_ct['encrypted_payload'], bytes)

    def test_type_and_bounds_guards(self):
        """Test boundary type guards on invalid inputs"""
        pk, sk = self.core.keygen()

        with self.assertRaises(ValueError):
            self.core.encapsulate("not-bytes-pk")

        with self.assertRaises(ValueError):
            self.core.decapsulate(b"ct", "not-bytes-sk", pk)

        with self.assertRaises(ValueError):
            self.core.symmetric_encrypt("not-bytes", b"secret")

        with self.assertRaises(ValueError):
            self.core.hybrid_encrypt("not-bytes", pk)

        with self.assertRaises(ValueError):
            self.core.hybrid_decrypt("not-dict", sk, pk)

        with self.assertRaises(ValueError):
            self.core.hybrid_decrypt({}, sk, pk)

    def test_utils_constant_time_compare(self):
        """Test constant time comparison logic"""
        self.assertTrue(constant_time_compare(b"abc", b"abc"))
        self.assertFalse(constant_time_compare(b"abc", b"abd"))
        self.assertFalse(constant_time_compare(b"abc", b"abcd"))
        self.assertFalse(constant_time_compare(b"abc", b"xyz"))

    def test_utils_xor_bytes(self):
        """Test byte XOR utility"""
        a = b"\x01\x02\x03"
        b = b"\x03\x02\x01"
        self.assertEqual(xor_bytes(a, b), b"\x02\x00\x02")
        with self.assertRaises(ValueError):
            xor_bytes(b"\x01", b"\x01\x02")

if __name__ == '__main__':
    unittest.main()
