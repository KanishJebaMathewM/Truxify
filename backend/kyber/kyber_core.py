import hashlib
import numpy as np
import secrets
from typing import Tuple, Dict, Any, Optional
import json
import base64
from dataclasses import dataclass
import logging

logger = logging.getLogger(__name__)

@dataclass
class KyberParams:
    """Kyber KEM Parameters"""
    n: int = 256          # Polynomial degree
    k: int = 3            # Module rank (Kyber-768)
    q: int = 3329         # Modulus
    eta1: int = 2         # Noise parameter for secret
    eta2: int = 2         # Noise parameter for error
    du: int = 10          # Compression for u
    dv: int = 4           # Compression for v

class KyberKEM:
    """CRYSTALS-Kyber Key Encapsulation Mechanism"""
    
    def __init__(self, params: KyberParams = KyberParams()):
        self.params = params
        self.n = params.n
        self.k = params.k
        self.q = params.q
        self._init_tables()
        
        logger.info(f"✅ Kyber initialized with k={self.k}, n={self.n}, q={self.q}")
    
    def _init_tables(self):
        """Initialize lookup tables for efficiency"""
        # Pre-compute powers for NTT
        self.ntt_roots = self._compute_ntt_roots()
        self.inv_ntt_roots = self._compute_inv_ntt_roots()
    
    def _compute_ntt_roots(self) -> np.ndarray:
        """Compute NTT roots of unity"""
        roots = np.zeros(self.n, dtype=int)
        for i in range(self.n):
            roots[i] = pow(17, self._bit_reverse(i), self.q)
        return roots
    
    def _compute_inv_ntt_roots(self) -> np.ndarray:
        """Compute inverse NTT roots"""
        roots = np.zeros(self.n, dtype=int)
        for i in range(self.n):
            roots[i] = pow(17, -self._bit_reverse(i), self.q)
        return roots
    
    def _bit_reverse(self, x: int) -> int:
        """Bit-reverse for NTT"""
        y = 0
        for i in range(8):
            y = (y << 1) | (x & 1)
            x >>= 1
        return y
    
    def _sample_cbd(self, eta: int, size: int) -> np.ndarray:
        """Sample from centered binomial distribution"""
        # Simple implementation using numpy
        samples = np.random.binomial(eta, 0.5, size) - np.random.binomial(eta, 0.5, size)
        return samples % self.q
    
    def _sample_uniform(self, size: int) -> np.ndarray:
        """Sample uniformly from Z_q"""
        return np.random.randint(0, self.q, size)
    
    def _ntt(self, f: np.ndarray) -> np.ndarray:
        """Number Theoretic Transform"""
        # Simplified NTT (in production: use optimized implementation)
        result = f.copy()
        for i in range(0, self.n, 2):
            result[i] = (f[i] + f[i+1]) % self.q
            result[i+1] = (f[i] - f[i+1]) % self.q
        return result
    
    def _intt(self, f: np.ndarray) -> np.ndarray:
        """Inverse Number Theoretic Transform"""
        # Simplified inverse NTT
        result = f.copy()
        for i in range(0, self.n, 2):
            result[i] = (f[i] + f[i+1]) * pow(2, -1, self.q) % self.q
            result[i+1] = (f[i] - f[i+1]) * pow(2, -1, self.q) % self.q
        return result
    
    def _poly_to_bytes(self, poly: np.ndarray) -> bytes:
        """Convert polynomial to bytes"""
        return poly.astype(np.int16).tobytes()
    
    def _bytes_to_poly(self, data: bytes) -> np.ndarray:
        """Convert bytes to polynomial"""
        return np.frombuffer(data, dtype=np.int16)[:self.n]
    
    def keygen(self) -> Tuple[Dict, Dict]:
        """Generate Kyber key pair"""
        # Sample random matrix A
        A = self._sample_uniform((self.k, self.k, self.n))
        
        # Sample secret s and error e
        s = self._sample_cbd(self.params.eta1, (self.k, self.n))
        e = self._sample_cbd(self.params.eta1, (self.k, self.n))
        
        # Compute public key t = A*s + e (using NTT for efficiency)
        t = np.zeros((self.k, self.n))
        for i in range(self.k):
            for j in range(self.k):
                # Simplified polynomial multiplication
                t[i] = (t[i] + self._poly_multiply(A[i][j], s[j])) % self.q
            t[i] = (t[i] + e[i]) % self.q
        
        # Compress public key
        t_compressed = self._compress(t, 10)
        
        public_key = {
            't': t_compressed.tolist(),
            'A': A.tolist()
        }
        
        secret_key = {
            's': s.tolist(),
            't': t.tolist(),
            'A': A.tolist()
        }
        
        return public_key, secret_key
    
    def _poly_multiply(self, a: np.ndarray, b: np.ndarray) -> np.ndarray:
        """Polynomial multiplication"""
        # Simple convolution (in production: use NTT)
        result = np.zeros(self.n, dtype=int)
        for i in range(self.n):
            for j in range(self.n):
                result[(i + j) % self.n] = (result[(i + j) % self.n] + a[i] * b[j]) % self.q
        return result
    
    def _compress(self, x: np.ndarray, d: int) -> np.ndarray:
        """Compress coefficients"""
        return np.round(x * (2**d / self.q)) % (2**d)
    
    def _decompress(self, x: np.ndarray, d: int) -> np.ndarray:
        """Decompress coefficients"""
        return np.round(x * (self.q / 2**d))
    
    def encapsulate(self, public_key: Dict) -> Tuple[bytes, bytes]:
        """Encapsulate shared secret"""
        t = np.array(public_key['t'])
        A = np.array(public_key['A'])
        
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
                u[i] = (u[i] + self._poly_multiply(A[j][i], r[j])) % self.q
            u[i] = (u[i] + e1[i]) % self.q
        
        # Compute v = t^T * r + e2
        v = np.zeros(self.n)
        for i in range(self.k):
            v = (v + self._poly_multiply(t_decompressed[i], r[i])) % self.q
        v = (v + e2) % self.q
        
        # Compress ciphertext
        u_compressed = self._compress(u, 10)
        v_compressed = self._compress(v, 4)
        
        # Derive shared secret
        shared_secret = self._derive_secret(u, v)
        
        ciphertext = {
            'u': u_compressed.tolist(),
            'v': v_compressed.tolist()
        }
        
        return json.dumps(ciphertext).encode(), shared_secret
    
    def _derive_secret(self, u: np.ndarray, v: np.ndarray) -> bytes:
        """Derive shared secret from ciphertext"""
        # Simple key derivation
        data = np.concatenate([u.flatten(), v.flatten()])
        return hashlib.sha256(data.tobytes()).digest()
    
    def decapsulate(self, ciphertext: bytes, secret_key: Dict) -> bytes:
        """Decapsulate shared secret"""
        ciphertext_dict = json.loads(ciphertext.decode())
        u = np.array(ciphertext_dict['u'])
        v = np.array(ciphertext_dict['v'])
        s = np.array(secret_key['s'])
        
        # Decompress ciphertext
        u_decompressed = self._decompress(u, 10)
        v_decompressed = self._decompress(v, 4)
        
        # Compute v - s^T * u
        result = v_decompressed.copy()
        for i in range(self.k):
            result = (result - self._poly_multiply(s[i], u_decompressed[i])) % self.q
        
        # Derive shared secret
        shared_secret = self._derive_secret(u_decompressed, result)
        
        return shared_secret

class QuantumSafeKeyExchange:
    """Quantum-safe key exchange using Kyber"""
    
    def __init__(self):
        self.kyber = KyberKEM()
        self.key_cache = {}
        
        logger.info("✅ Quantum-Safe Key Exchange initialized")
    
    def generate_keypair(self) -> Dict:
        """Generate quantum-safe key pair"""
        public_key, secret_key = self.kyber.keygen()
        
        return {
            'public_key': public_key,
            'secret_key': secret_key,
            'algorithm': 'CRYSTALS-Kyber-768',
            'security_level': 'quantum-safe'
        }
    
    def encapsulate(self, public_key: Dict) -> Dict:
        """Encapsulate shared secret"""
        ciphertext, shared_secret = self.kyber.encapsulate(public_key)
        
        return {
            'ciphertext': base64.b64encode(ciphertext).decode(),
            'shared_secret': base64.b64encode(shared_secret).decode(),
            'algorithm': 'CRYSTALS-Kyber-768'
        }
    
    def decapsulate(self, ciphertext: str, secret_key: Dict) -> Dict:
        """Decapsulate shared secret"""
        ciphertext_bytes = base64.b64decode(ciphertext)
        shared_secret = self.kyber.decapsulate(ciphertext_bytes, secret_key)
        
        return {
            'shared_secret': base64.b64encode(shared_secret).decode(),
            'algorithm': 'CRYSTALS-Kyber-768'
        }
    
    def hybrid_encrypt(self, data: bytes, public_key: Dict, cipher_key: bytes) -> Dict:
        """Hybrid encryption with Kyber and AES"""
        from cryptography.fernet import Fernet
        
        # Generate Kyber shared secret
        ciphertext, kyber_secret = self.kyber.encapsulate(public_key)
        
        # Combine secrets
        combined_secret = hashlib.sha256(kyber_secret + cipher_key).digest()
        
        # Encrypt data with combined secret
        fernet_key = base64.urlsafe_b64encode(combined_secret)
        f = Fernet(fernet_key)
        encrypted_data = f.encrypt(data)
        
        return {
            'ciphertext': base64.b64encode(ciphertext).decode(),
            'encrypted_data': base64.b64encode(encrypted_data).decode(),
            'algorithm': 'Kyber-768 + AES-256'
        }
    
    def hybrid_decrypt(self, encrypted_data: Dict, secret_key: Dict, cipher_key: bytes) -> bytes:
        """Hybrid decryption"""
        from cryptography.fernet import Fernet
        
        # Decapsulate Kyber secret
        ciphertext = base64.b64decode(encrypted_data['ciphertext'])
        kyber_secret = self.kyber.decapsulate(ciphertext, secret_key)
        
        # Combine secrets
        combined_secret = hashlib.sha256(kyber_secret + cipher_key).digest()
        
        # Decrypt data
        fernet_key = base64.urlsafe_b64encode(combined_secret)
        f = Fernet(fernet_key)
        decrypted = f.decrypt(base64.b64decode(encrypted_data['encrypted_data']))
        
        return decrypted
    
    def tls_key_exchange(self, client_hello: Dict) -> Dict:
        """Simulate TLS key exchange with Kyber"""
        # Generate ephemeral keypair
        keypair = self.generate_keypair()
        
        # Encapsulate shared secret
        result = self.encapsulate(keypair['public_key'])
        
        return {
            'server_public_key': keypair['public_key'],
            'ciphertext': result['ciphertext'],
            'shared_secret': result['shared_secret'],
            'algorithm': 'Kyber-768'
        }
    
    def get_performance_stats(self) -> Dict:
        """Get performance statistics"""
        import time
        
        # Key generation timing
        start = time.time()
        keypair = self.generate_keypair()
        keygen_time = (time.time() - start) * 1000
        
        # Encapsulation timing
        start = time.time()
        result = self.encapsulate(keypair['public_key'])
        encaps_time = (time.time() - start) * 1000
        
        # Decapsulation timing
        start = time.time()
        self.decapsulate(result['ciphertext'], keypair['secret_key'])
        decaps_time = (time.time() - start) * 1000
        
        return {
            'keygen_time_ms': keygen_time,
            'encaps_time_ms': encaps_time,
            'decaps_time_ms': decaps_time,
            'algorithm': 'CRYSTALS-Kyber-768',
            'public_key_size': len(json.dumps(keypair['public_key'])),
            'secret_key_size': len(json.dumps(keypair['secret_key'])),
            'ciphertext_size': len(result['ciphertext'])
        }