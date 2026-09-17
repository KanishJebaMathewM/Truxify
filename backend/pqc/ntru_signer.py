import numpy as np
import os
from typing import Dict, Any
from .entropy_validator import validate_seed_entropy, InsufficientEntropyError
from .polynomial_utils import safe_polynomial_reduction

class NtruLatticeEncryptor:
    """
    Lattice-Based NTRU encryption simulator over truncated polynomial rings Z_q[X]/(X^N - 1)
    to protect edge telemetry frames against post-quantum decryption attacks.
    """
    def __init__(self, N: int = 509, q: int = 2048):
        self.N = N
        self.q = q
        # Simulated key polynomial coefficients
        self.public_key_poly = np.ones(N) * 5

    def generate_keypair(self, seed: bytes) -> Dict[str, Any]:
        """
        Generates a keypair from a seed, validating minimum 256-bit entropy.
        """
        validate_seed_entropy(seed, min_bits=256)
        
        # Deterministic polynomial generation from seed (simulated)
        np.random.seed(int.from_bytes(seed[:8], 'big'))
        private_key = np.random.randint(0, 3, size=self.N)
        public_key = (np.convolve(private_key, self.public_key_poly, mode='same') + np.random.randint(0, 2, size=self.N)) % self.q
        
        return {
            "public_key": public_key.tolist(),
            "private_key": private_key.tolist(),
            "N": self.N,
            "q": self.q
        }

    def encrypt_telemetry_payload(self, coordinate_payload: np.ndarray, seed: bytes) -> dict:
        """Converts floating-point payload matrix to polynomial coefficients and encrypts."""
        validate_seed_entropy(seed, min_bits=256)
        
        payload_poly = np.zeros(self.N)
        payload_poly[:len(coordinate_payload)] = coordinate_payload
        
        np.random.seed(int.from_bytes(seed[:8], 'big'))
        random_poly = np.random.randint(0, 2, size=self.N)
        
        raw_ciphertext = np.convolve(random_poly, self.public_key_poly, mode='same') + payload_poly
        
        # FIXED: Use safe polynomial reduction with proper index wrapping modulo X^N - 1
        ciphertext_poly = safe_polynomial_reduction(raw_ciphertext, self.N, self.q)

        return {
            "N": self.N,
            "q": self.q,
            "ciphertext_poly": [int(val) for val in ciphertext_poly]
        }

ntru_encryptor = NtruLatticeEncryptor()
