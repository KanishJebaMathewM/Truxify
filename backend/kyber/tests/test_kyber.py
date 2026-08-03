"""Round-trip tests for the Kyber KEM shared-secret derivation.

Regression test for the encapsulate/decapsulate shared-secret mismatch:
encapsulate derived the secret from the uncompressed ciphertext while
decapsulate derived it from the decompressed ciphertext, so the two halves
of the KEM never produced the same key.
"""
import sys
import os
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kyber_core import KyberKEM, QuantumSafeKeyExchange


def test_kyber_kem_round_trip():
    np.random.seed(42)
    kem = KyberKEM()
    public_key, secret_key = kem.keygen()
    ciphertext, shared_secret = kem.encapsulate(public_key)
    decapsulated = kem.decapsulate(ciphertext, secret_key)
    assert decapsulated == shared_secret


def test_kyber_kem_multiple_round_trips():
    np.random.seed(7)
    kem = KyberKEM()
    public_key, secret_key = kem.keygen()
    for _ in range(5):
        ciphertext, shared_secret = kem.encapsulate(public_key)
        decapsulated = kem.decapsulate(ciphertext, secret_key)
        assert decapsulated == shared_secret


def test_quantum_safe_key_exchange_round_trip():
    np.random.seed(99)
    exchange = QuantumSafeKeyExchange()
    keypair = exchange.generate_keypair()
    encapsulated = exchange.encapsulate(keypair["public_key"])
    decapsulated = exchange.decapsulate(
        encapsulated["ciphertext"], keypair["secret_key"]
    )
    assert decapsulated["shared_secret"] == encapsulated["shared_secret"]
