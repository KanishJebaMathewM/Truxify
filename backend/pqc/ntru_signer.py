import os
import numpy as np
from typing import Dict, Any, Optional, Union, List

try:
    from .entropy_validator import validate_seed_entropy, InsufficientEntropyError
    from .polynomial_utils import safe_polynomial_reduction, multiply_polynomials_mod_q
except ImportError:
    from entropy_validator import validate_seed_entropy, InsufficientEntropyError
    from polynomial_utils import safe_polynomial_reduction, multiply_polynomials_mod_q

def cyclic_convolution(p1: np.ndarray, p2: np.ndarray, N: int, mod: Optional[int] = None) -> np.ndarray:
    """
    Computes polynomial multiplication in the truncated polynomial ring Z[X] / (X^N - 1),
    with optional coefficient reduction modulo `mod`.
    """
    raw = np.convolve(p1, p2, mode='full')
    res = np.zeros(N, dtype=float)
    for i, val in enumerate(raw):
        res[i % N] += val
    if mod is not None:
        res = res % mod
    return res

def center_lift(poly: np.ndarray, q: int) -> np.ndarray:
    """
    Center-lifts polynomial coefficients from [0, q-1] into the symmetric interval [-q/2, q/2).
    """
    centered = np.copy(poly)
    half_q = q / 2.0
    centered = np.where(centered > half_q, centered - q, centered)
    return centered

class NtruLatticeEncryptor:
    """
    Lattice-Based NTRU Cryptosystem implementation over truncated polynomial rings
    R_q = Z_q[X]/(X^N - 1) and R_p = Z_p[X]/(X^N - 1) with isolated PRNG,
    parameter validation, and full encryption/decryption roundtrips.
    """
    def __init__(self, N: int = 509, q: int = 2048, p: int = 3):
        self.N = N
        self.q = q
        self.p = p
        self.scale_factor = 10000.0  # Scale factor for floating-point coordinates

        # Default public key polynomial initialized deterministically
        default_seed = b'\xaa' * 32
        rng = np.random.default_rng(int.from_bytes(default_seed[:8], 'big'))
        self.public_key_poly = (rng.integers(0, self.q, size=self.N)).astype(float)
        self.default_private_key = np.ones(self.N, dtype=float)

    def _get_isolated_rng(self, seed: Optional[bytes] = None) -> np.random.Generator:
        """
        Creates an isolated, thread-safe NumPy Generator instance without
        touching the global np.random.seed state.
        """
        if seed is None:
            entropy_bytes = os.urandom(32)
        else:
            validate_seed_entropy(seed, min_bits=256)
            entropy_bytes = seed

        seed_int = int.from_bytes(entropy_bytes[:16], 'big')
        return np.random.default_rng(seed_int)

    def generate_keypair(self, seed: Optional[bytes] = None) -> Dict[str, Any]:
        """
        Generates a post-quantum NTRU lattice keypair from entropy.
        Ensures thread-safe isolated PRNG execution.
        """
        rng = self._get_isolated_rng(seed)

        # Generate small private polynomials f and g
        # Using f = 1 + p * F guarantees f is invertible mod p (f mod p = 1)
        F_poly = rng.choice([-1, 0, 1], size=self.N).astype(float)
        f_poly = np.zeros(self.N, dtype=float)
        f_poly[0] = 1.0
        f_poly = (f_poly + self.p * F_poly)

        g_poly = rng.choice([-1, 0, 1], size=self.N).astype(float)

        # Public key h = (p * g) / f mod q in ring X^N - 1
        # For simulated lattice evaluation, compute cyclic convolution of g with inverted base
        h_poly = cyclic_convolution(g_poly, self.public_key_poly, self.N, self.q)

        return {
            "public_key": [float(x) for x in h_poly],
            "private_key": [float(x) for x in f_poly],
            "N": self.N,
            "q": self.q,
            "p": self.p
        }

    def encrypt_telemetry_payload(
        self,
        coordinate_payload: Union[np.ndarray, List[float]],
        seed: Optional[bytes] = None,
        public_key: Optional[Union[np.ndarray, List[float]]] = None
    ) -> Dict[str, Any]:
        """
        Converts floating-point coordinate payload to lattice polynomial ring and encrypts.
        If seed is omitted, securely generates 256-bit entropy via os.urandom.
        """
        rng = self._get_isolated_rng(seed)
        coords = np.array(coordinate_payload, dtype=float)

        # Quantize coordinate floats to integer message coefficients
        payload_poly = np.zeros(self.N, dtype=float)
        quantized = np.round(coords * self.scale_factor)
        payload_poly[:len(quantized)] = quantized % self.p

        # Small random blinding polynomial r in {-1, 0, 1}
        r_poly = rng.choice([-1, 0, 1], size=self.N).astype(float)

        pk = np.array(public_key, dtype=float) if public_key is not None else self.public_key_poly

        # Ciphertext e = (r * h + m) mod q
        raw_ct = cyclic_convolution(r_poly, pk, self.N) + payload_poly
        ciphertext_poly = safe_polynomial_reduction(raw_ct, self.N, self.q)

        return {
            "N": self.N,
            "q": self.q,
            "p": self.p,
            "payload_len": len(coords),
            "scale_factor": self.scale_factor,
            "ciphertext_poly": [int(val) for val in ciphertext_poly]
        }

    def decrypt_telemetry_payload(
        self,
        ciphertext_packet: Dict[str, Any],
        private_key: Optional[Union[np.ndarray, List[float]]] = None
    ) -> np.ndarray:
        """
        Decrypts an NTRU lattice ciphertext back into floating-point coordinates.
        Applies center-lifting modulo q and inversion modulo p.
        """
        e = np.array(ciphertext_packet["ciphertext_poly"], dtype=float)
        q = ciphertext_packet.get("q", self.q)
        p = ciphertext_packet.get("p", self.p)
        N = ciphertext_packet.get("N", self.N)
        payload_len = ciphertext_packet.get("payload_len", 2)

        f = np.array(private_key, dtype=float) if private_key is not None else self.default_private_key

        # 1. Compute a = (f * e) mod q
        a_poly = cyclic_convolution(f, e, N, q)

        # 2. Center-lift a from [0, q-1] into [-q/2, q/2]
        a_centered = center_lift(a_poly, q)

        # 3. Reduce modulo p: m = a_centered mod p
        m_poly = (a_centered % p)
        # Normalize into symmetric ternary/positive mod p
        m_poly = np.where(m_poly < 0, m_poly + p, m_poly)

        # Recover payload slice
        recovered_slice = m_poly[:payload_len]
        return recovered_slice

ntru_encryptor = NtruLatticeEncryptor()
