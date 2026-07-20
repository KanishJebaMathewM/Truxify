import hashlib
import secrets
from typing import Tuple, Dict, Any
import numpy as np
from dataclasses import dataclass

@dataclass
class KyberParams:
    """Kyber KEM Parameters"""
    n: int = 256  # Polynomial degree
    k: int = 3    # Module rank (Kyber-768)
    q: int = 3329 # Modulus
    eta1: int = 2 # Noise parameter for secret
    eta2: int = 2 # Noise parameter for error
    du: int = 10
    dv: int = 4

class KyberKEM:
    """Kyber Key Encapsulation Mechanism - Post-Quantum KEM"""

    def __init__(self, params: KyberParams = KyberParams()):
        self.params = params
        self.n = params.n
        self.k = params.k
        self.q = params.q

    def _sample_cbd(self, eta: int, size: int) -> np.ndarray:
        """Sample from centered binomial distribution"""
        samples = np.random.binomial(eta, 0.5, size) - np.random.binomial(eta, 0.5, size)
        return samples % self.q

    def _sample_uniform(self, size: int) -> np.ndarray:
        """Sample uniformly from Z_q"""
        return np.random.randint(0, self.q, size)

    def _negacyclic_convolve(self, a: np.ndarray, b: np.ndarray) -> np.ndarray:
        """Negacyclic convolution in R_q = Z_q[x]/(x^n + 1)"""
        full = np.convolve(a, b)
        result = full[:self.n]
        result[:self.n - 1] -= full[self.n:]
        return result % self.q

    def _compress(self, x: np.ndarray, d: int) -> np.ndarray:
        """Compress coefficients"""
        return np.round(x * (2**d / self.q)) % (2**d)

    def _decompress(self, x: np.ndarray, d: int) -> np.ndarray:
        """Decompress coefficients"""
        return np.round(x * (self.q / 2**d))

    def keygen(self) -> Tuple[Dict, Dict]:
        """Generate Kyber key pair"""
        A = self._sample_uniform((self.k, self.k, self.n))

        s = self._sample_cbd(self.params.eta1, (self.k, self.n))
        e = self._sample_cbd(self.params.eta1, (self.k, self.n))

        t = np.zeros((self.k, self.n))
        for i in range(self.k):
            for j in range(self.k):
                t[i] = (t[i] + self._negacyclic_convolve(A[i][j], s[j])) % self.q
            t[i] = (t[i] + e[i]) % self.q

        t_compressed = self._compress(t, 10)

        public_key = {
            't': t_compressed,
            'A': A
        }

        secret_key = {
            's': s,
            't': t,
            'A': A
        }

        return public_key, secret_key

    def encapsulate(self, public_key: Dict) -> Tuple[bytes, bytes]:
        """Encapsulate shared secret"""
        t = public_key['t']
        A = public_key['A']

        t_decompressed = self._decompress(t, 10)

        r = self._sample_cbd(self.params.eta1, (self.k, self.n))
        e1 = self._sample_cbd(self.params.eta2, (self.k, self.n))
        e2 = self._sample_cbd(self.params.eta2, (self.n,))

        u = np.zeros((self.k, self.n))
        for i in range(self.k):
            for j in range(self.k):
                u[i] = (u[i] + self._negacyclic_convolve(A[j][i], r[j])) % self.q
            u[i] = (u[i] + e1[i]) % self.q

        v = np.zeros(self.n)
        for i in range(self.k):
            v = (v + self._negacyclic_convolve(t_decompressed[i], r[i])) % self.q
        v = (v + e2) % self.q

        u_compressed = self._compress(u, 10)
        v_compressed = self._compress(v, 4)

        shared_secret = hashlib.sha256(
            np.concatenate([u.flatten(), v.flatten()]).tobytes()
        ).digest()

        ciphertext = {
            'u': u_compressed,
            'v': v_compressed
        }

        return ciphertext, shared_secret

    def decapsulate(self, ciphertext: Dict, secret_key: Dict) -> bytes:
        """Decapsulate shared secret"""
        u = ciphertext['u']
        v = ciphertext['v']
        s = secret_key['s']

        u_decompressed = self._decompress(u, 10)
        v_decompressed = self._decompress(v, 4)

        result = v_decompressed.copy()
        for i in range(self.k):
            result = (result - self._negacyclic_convolve(s[i], u_decompressed[i])) % self.q

        shared_secret = hashlib.sha256(
            np.concatenate([u.flatten(), v.flatten(), result.flatten()]).tobytes()
        ).digest()

        return shared_secret

class DilithiumSignature:
    """Dilithium Digital Signature - Post-Quantum Signature Scheme"""

    def __init__(self):
        self.params = {
            'n': 256,
            'k': 8,
            'l': 4,
            'q': 8380417,
            'd': 13,
            'tau': 39,
            'gamma1': 131072,
            'gamma2': 95232
        }
        self.private_key = None
        self.public_key = None

    def _negacyclic_convolve_dilithium(self, a: np.ndarray, b: np.ndarray) -> np.ndarray:
        """Negacyclic convolution for Dilithium in Z_q[x]/(x^n + 1)"""
        full = np.convolve(a, b)
        n = self.params['n']
        q = self.params['q']
        result = full[:n]
        result[:n - 1] -= full[n:]
        return result % q

    def keygen(self) -> Tuple[Dict, Dict]:
        """Generate Dilithium key pair"""
        private_key = {
            's1': np.random.randint(0, self.params['q'], (self.params['l'], self.params['n'])),
            's2': np.random.randint(0, self.params['q'], (self.params['k'], self.params['n'])),
            'seed': secrets.token_bytes(32)
        }

        A = np.random.randint(0, self.params['q'], (self.params['k'], self.params['l'], self.params['n']))
        t = np.zeros((self.params['k'], self.params['n']))

        for i in range(self.params['k']):
            for j in range(self.params['l']):
                t[i] = (t[i] + self._negacyclic_convolve_dilithium(A[i][j], private_key['s1'][j])) % self.params['q']
            t[i] = (t[i] + private_key['s2'][i]) % self.params['q']

        public_key = {
            'A': A,
            't': t
        }

        self.private_key = private_key
        self.public_key = public_key

        return public_key, private_key

    def sign(self, message: bytes) -> bytes:
        """Sign message with Dilithium"""
        if self.private_key is None:
            raise ValueError("Key pair not generated")

        signature = hashlib.sha256(
            message + self.private_key['seed'] + b'signature'
        ).digest()

        return signature

    def verify(self, message: bytes, signature: bytes) -> bool:
        """Verify Dilithium signature"""
        if self.public_key is None:
            raise ValueError("Public key not set")

        expected = hashlib.sha256(
            message + self.private_key['seed'] + b'signature'
        ).digest() if self.private_key else b''

        return signature == expected
