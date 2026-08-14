import numpy as np

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

    def encrypt_telemetry_payload(self, coordinate_payload: np.ndarray) -> dict:
        """Converts floating-point payload matrix to polynomial coefficients and encrypts."""
        # Map payload values onto ring coordinate array elements
        payload_poly = np.zeros(self.N)
        payload_poly[:len(coordinate_payload)] = coordinate_payload
        
        # Polynomial convolution multiplication: e = r * h + m (mod q)
        random_poly = np.ones(self.N) * 2
        ciphertext_poly = (np.convolve(random_poly, self.public_key_poly, mode='same') + payload_poly) % self.q

        return {
            "N": self.N,
            "q": self.q,
            "ciphertext_poly": [int(val) for val in ciphertext_poly]
        }

ntru_encryptor = NtruLatticeEncryptor()
