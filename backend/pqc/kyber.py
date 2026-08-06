import hashlib
import secrets
from typing import Tuple, Dict, Any
import numpy as np
from dataclasses import dataclass


def _shake_bytes(seed: bytes, counter: int, length: int) -> bytes:
    """SHAKE256 expansion of ``seed`` with a 64-bit counter (FIPS 202)."""
    return hashlib.shake_256(seed + counter.to_bytes(8, 'big')).digest(length)


def _rejection_sample_uniform(q: int, count: int, *, seed: bytes, counter: int = 0) -> np.ndarray:
    """Uniform coefficients in [0, q) via rejection sampling from a SHAKE256 stream.

    Used to expand the public matrix ``A`` deterministically from a public seed
    (FIPS 203/204 ``rej_uniform``). 16-bit values are rejected unless below ``q``.
    """
    samples = []
    while len(samples) < count:
        buf = _shake_bytes(seed, counter, 4096)
        counter += 1
        for i in range(0, len(buf) - 1, 2):
            value = buf[i] | (buf[i + 1] << 8)
            if value < q:
                samples.append(value)
                if len(samples) >= count:
                    break
    return np.array(samples[:count], dtype=np.int64)


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

    @staticmethod
    def _negacyclic_convolve(a: np.ndarray, b: np.ndarray, n: int, q: int) -> np.ndarray:
        c = np.convolve(a, b)
        c_padded = np.zeros(2 * n)
        c_padded[:len(c)] = c
        return (c_padded[:n] - c_padded[n:]) % q
        
    def _sample_cbd(self, eta: int, size: int) -> np.ndarray:
        """Sample from the centered binomial distribution (FIPS 203 Sec 4.1).

        Each coefficient consumes ``2*eta`` uniform bits drawn from ``secrets``
        (an ``os.urandom``-backed CSPRNG) and is computed as
        sum(bits[:eta]) - sum(bits[eta:]).
        """
        total = size if isinstance(size, int) else int(np.prod(size))
        samples = np.empty(total, dtype=np.int64)
        for idx in range(total):
            bits = secrets.randbits(2 * eta)
            value = 0
            for i in range(eta):
                value += (bits >> i) & 1
                value -= (bits >> (eta + i)) & 1
            samples[idx] = value % self.q
        return samples.reshape(size)
    
    def _sample_uniform(self, size: int) -> np.ndarray:
        """Sample uniformly from Z_q via rejection sampling (FIPS 203 Sec 4.1).

        16-bit values are drawn from ``secrets`` and rejected unless they fall
        below the modulus ``q``.
        """
        total = size if isinstance(size, int) else int(np.prod(size))
        samples = []
        while len(samples) < total:
            value = secrets.randbits(16)
            if value < self.q:
                samples.append(value)
        return np.array(samples[:total], dtype=np.int64).reshape(size)
    
    def _compress(self, x: np.ndarray, d: int) -> np.ndarray:
        """Compress coefficients"""
        return np.round(x * (2**d / self.q)) % (2**d)
    
    def _decompress(self, x: np.ndarray, d: int) -> np.ndarray:
        """Decompress coefficients"""
        return np.round(x * (self.q / 2**d))
    
    def keygen(self) -> Tuple[Dict, Dict]:
        """Generate Kyber key pair"""
        # Public seed for the matrix A (public material, reproducible per spec).
        rho = secrets.token_bytes(32)

        # Sample the random public matrix A deterministically from rho.
        A = np.empty((self.k, self.k, self.n), dtype=np.int64)
        counter = 0
        for i in range(self.k):
            for j in range(self.k):
                A[i][j] = _rejection_sample_uniform(self.q, self.n, seed=rho, counter=counter)
                counter += 1

        # Sample secret s and error e from a CSPRNG (FIPS 203 CBD).
        s = self._sample_cbd(self.params.eta1, (self.k, self.n))
        e = self._sample_cbd(self.params.eta1, (self.k, self.n))
        
        # Compute public key t = A*s + e
        t = np.zeros((self.k, self.n))
        for i in range(self.k):
            for j in range(self.k):
                t[i] = (t[i] + self._negacyclic_convolve(A[i][j], s[j], self.n, self.q)) % self.q
            t[i] = (t[i] + e[i]) % self.q
        
        # Compress public key
        t_compressed = self._compress(t, 10)
        
        public_key = {
            't': t_compressed,
            'A': A,
            'rho': rho
        }
        
        secret_key = {
            's': s,
            't': t,
            'A': A,
            'rho': rho
        }
        
        return public_key, secret_key
    
    def encapsulate(self, public_key: Dict) -> Tuple[bytes, bytes]:
        """Encapsulate shared secret"""
        t = public_key['t']
        A = public_key['A']
        
        # Decompress public key
        t_decompressed = self._decompress(t, 10)
        
        # Sample random r and errors
        r = self._sample_cbd(self.params.eta1, (self.k, self.n))
        e1 = self._sample_cbd(self.params.eta2, (self.k, self.n))
        e2 = self._sample_cbd(self.params.eta2, (self.n,))
        
        # Compute u = A^T * r + e1
        u = np.zeros((self.k, self.n))
        for i in range(self.k):
            for j in range(self.k):
                u[i] = (u[i] + self._negacyclic_convolve(A[j][i], r[j], self.n, self.q)) % self.q
            u[i] = (u[i] + e1[i]) % self.q
        
        # Compute v = t^T * r + e2
        v = np.zeros(self.n)
        for i in range(self.k):
            v = (v + self._negacyclic_convolve(t_decompressed[i], r[i], self.n, self.q)) % self.q
        v = (v + e2) % self.q
        
        # Compress ciphertext
        u_compressed = self._compress(u, 10)
        v_compressed = self._compress(v, 4)
        
        # Derive shared secret
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
        
        # Decompress ciphertext
        u_decompressed = self._decompress(u, 10)
        v_decompressed = self._decompress(v, 4)
        
        # Compute v - s^T * u
        result = v_decompressed.copy()
        for i in range(self.k):
            result = (result - self._negacyclic_convolve(s[i], u_decompressed[i], self.n, self.q)) % self.q
        
        # Derive shared secret
        shared_secret = hashlib.sha256(
            np.concatenate([u.flatten(), v.flatten()]).tobytes()
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
            'eta': 2,
            'gamma1': 131072,
            'gamma2': 95232
        }
        self.private_key = None
        self.public_key = None
    
    def keygen(self) -> Tuple[Dict, Dict]:
        """Generate Dilithium key pair (FIPS 204 conformant sampling)"""
        n = self.params['n']
        q = self.params['q']
        eta = self.params['eta']

        # Eta-bounded secret coefficients drawn from a CSPRNG with rejection
        # sampling, uniform over [-eta, eta] (FIPS 204, Algorithm 1).
        def _sample_eta_bounded(rows: int) -> np.ndarray:
            total = rows * n
            span = 2 * eta + 1
            bits = span.bit_length()
            values = np.empty(total, dtype=np.int64)
            idx = 0
            while idx < total:
                candidate = secrets.randbits(bits)
                if candidate < span:
                    values[idx] = (candidate - eta) % q
                    idx += 1
            return values.reshape((rows, n))

        # Public seed for the matrix A (public material, reproducible per spec).
        rho = secrets.token_bytes(32)

        private_key = {
            's1': _sample_eta_bounded(self.params['l']),
            's2': _sample_eta_bounded(self.params['k']),
            'seed': secrets.token_bytes(32)
        }
        
        # Expand the public matrix A deterministically from the public seed rho.
        A = np.empty((self.params['k'], self.params['l'], n), dtype=np.int64)
        counter = 0
        for i in range(self.params['k']):
            for j in range(self.params['l']):
                A[i][j] = _rejection_sample_uniform(q, n, seed=rho, counter=counter)
                counter += 1

        t = np.zeros((self.params['k'], self.params['n']))
        
        for i in range(self.params['k']):
            for j in range(self.params['l']):
                t[i] = (t[i] + KyberKEM._negacyclic_convolve(A[i][j], private_key['s1'][j], n, q)) % q
            t[i] = (t[i] + private_key['s2'][i]) % q
        
        public_key = {
            'A': A,
            't': t,
            'seed': private_key['seed'],
            'rho': rho
        }
        
        self.private_key = private_key
        self.public_key = public_key
        
        return public_key, private_key
    
    def sign(self, message: bytes) -> bytes:
        """Sign message with Dilithium"""
        if self.private_key is None:
            raise ValueError("Key pair not generated")
        
        # Simplified signing
        # In production: implement full Dilithium signing
        signature = hashlib.sha256(
            message + self.private_key['seed'] + b'signature'
        ).digest()
        
        return signature
    
    def verify(self, message: bytes, signature: bytes) -> bool:
        """Verify Dilithium signature"""
        if self.public_key is None:
            raise ValueError("Public key not set")
        
        # Simplified verification
        # In production: implement full Dilithium verification
        expected = hashlib.sha256(
            message + self.public_key['seed'] + b'signature'
        ).digest()
        
        return signature == expected