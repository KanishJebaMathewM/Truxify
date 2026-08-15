import json
import hashlib
import time
from datetime import datetime
from typing import Dict
import numpy as np
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import hashes
from kyber import KyberKEM, DilithiumSignature
import base64
import logging
import numpy as np

logger = logging.getLogger(__name__)

class HybridCrypto:
    """Hybrid Classical + Post-Quantum Cryptography"""
    
    def __init__(self):
        self.kyber = KyberKEM()
        self.dilithium = DilithiumSignature()
        self.classical_key = None
        self.quantum_key = None
        self.hybrid_key = None
        
    def generate_hybrid_keypair(self) -> Dict:
        """Generate hybrid key pair"""
        # Generate classical RSA key
        self.classical_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048
        )
        
        # Generate quantum Kyber key
        quantum_pub, quantum_priv = self.kyber.keygen()
        self.quantum_key = {
            'public': quantum_pub,
            'private': quantum_priv
        }
        
        # Generate Dilithium keys
        dilithium_pub, dilithium_priv = self.dilithium.keygen()
        
        # Combine keys
        hybrid_keys = {
            'classical': {
                'public': self.classical_key.public_key(),
                'private': self.classical_key
            },
            'quantum': self.quantum_key,
            'dilithium': {
                'public': dilithium_pub,
                'private': dilithium_priv
            },
            'hybrid_id': self._derive_hybrid_id(
                self.classical_key.public_key(),
                self.quantum_key['public'],
                dilithium_pub,
            )
        }
        
        return hybrid_keys

    @staticmethod
    def _derive_hybrid_id(classical_pub, quantum_pub, dilithium_pub) -> str:
        """Derive a stable, content-bound key identifier.

        The id is a full SHA-256 digest of the encoded public key material so
        the same key material always maps to the same id, it is high-entropy,
        and it does not leak key-generation timing. This replaces the previous
        ``time.time()``-based id which changed on every call (issue #13080).
        """
        def _material_bytes(material) -> bytes:
            if hasattr(material, 'tobytes'):
                return material.tobytes()
            if hasattr(material, 'public_bytes'):
                from cryptography.hazmat.primitives.serialization import (
                    Encoding,
                    PublicFormat,
                )
                return material.public_bytes(
                    encoding=Encoding.DER,
                    format=PublicFormat.SubjectPublicKeyInfo,
                )
            return bytes(material)

        digest = hashlib.sha256()
        digest.update(_material_bytes(classical_pub))
        digest.update(_material_bytes(quantum_pub))
        digest.update(_material_bytes(dilithium_pub))
        return digest.hexdigest()
    
    @staticmethod
    def _rsa_oaep_max_plaintext(public_key) -> int:
        """Max OAEP-SHA256 plaintext bytes for the RSA key: k - 2*hLen - 2.

        k = key size in bytes, hLen = 32 (SHA-256). Used to reject oversized
        payloads up front instead of letting the ciphertext primitive throw
        (issue #11676).
        """
        key_size_bytes = public_key.key_size // 8
        hlen = hashes.SHA256().digest_size
        return key_size_bytes - 2 * hlen - 2

    def hybrid_encrypt(self, data: bytes, hybrid_key: Dict) -> Dict:
        """Encrypt using hybrid approach"""
        try:
            # Generate quantum shared secret
            quantum_ciphertext, quantum_secret = self.kyber.encapsulate(
                hybrid_key['quantum']['public']
            )
            
            secret_len = len(quantum_secret)
            public_key = hybrid_key['classical']['public']

            # Injective framing: 4-byte big-endian length prefix + data +
            # quantum secret. The prefix disambiguates a data payload that
            # genuinely ends with the secret bytes (issue #11676).
            frame_header_len = 4
            max_plaintext = self._rsa_oaep_max_plaintext(public_key)
            if len(data) + frame_header_len + secret_len > max_plaintext:
                raise ValueError(
                    f"Data too large for RSA-OAEP: {len(data)} bytes exceeds "
                    f"the {max_plaintext - frame_header_len - secret_len}-byte "
                    "per-call limit. Chunk large payloads before encrypting."
                )

            framed = len(data).to_bytes(frame_header_len, 'big') + data + quantum_secret

            # Classical RSA encryption of the framed payload
            encrypted_data = public_key.encrypt(
                framed,
                padding.OAEP(
                    mgf=padding.MGF1(algorithm=hashes.SHA256()),
                    algorithm=hashes.SHA256(),
                    label=None
                )
            )
            
            # Create hybrid ciphertext
            ciphertext = {
                'quantum_ciphertext': self._serialize_kyber_ciphertext(quantum_ciphertext),
                'encrypted_data': base64.b64encode(encrypted_data).decode(),
                'hybrid_id': hybrid_key.get('hybrid_id', 'unknown')
            }
            
            return ciphertext
            
        except Exception as e:
            logger.error(f"Hybrid encryption failed: {e}")
            raise
    
    def hybrid_decrypt(self, ciphertext: Dict, hybrid_key: Dict) -> bytes:
        """Decrypt using hybrid approach"""
        try:
            # Recover quantum secret
            quantum_ciphertext = self._deserialize_kyber_ciphertext(
                ciphertext['quantum_ciphertext']
            )
            quantum_secret = self.kyber.decapsulate(
                quantum_ciphertext,
                hybrid_key['quantum']['private']
            )
            
            # Decrypt data
            decrypted = hybrid_key['classical']['private'].decrypt(
                base64.b64decode(ciphertext['encrypted_data']),
                padding.OAEP(
                    mgf=padding.MGF1(algorithm=hashes.SHA256()),
                    algorithm=hashes.SHA256(),
                    label=None
                )
            )
            
            # Recover data via the 4-byte length prefix. A trailing-secret
            # comparison alone was non-injective: genuine data ending with the
            # same bytes was silently truncated (issue #11676).
            secret_len = len(quantum_secret)
            if len(decrypted) < 4 + secret_len:
                raise ValueError(
                    f"Decrypted payload length ({len(decrypted)}) is shorter than "
                    f"the framing header + quantum secret ({4 + secret_len})"
                )

            payload_len = int.from_bytes(decrypted[:4], 'big')
            if payload_len > len(decrypted) - 4 - secret_len:
                raise ValueError("Invalid length prefix in decrypted payload")

            if decrypted[4 + payload_len:] != quantum_secret:
                raise ValueError("Quantum secret verification failed on decrypted payload")

            return decrypted[4:4 + payload_len]
            
        except Exception as e:
            logger.error(f"Hybrid decryption failed: {e}")
            raise
    
    def _serialize_kyber_ciphertext(self, ciphertext: Dict) -> str:
        """Serialize Kyber ciphertext"""
        return json.dumps({
            'u': ciphertext['u'].tolist(),
            'v': ciphertext['v'].tolist()
        })
    
    def _deserialize_kyber_ciphertext(self, serialized: str) -> Dict:
        """Deserialize Kyber ciphertext"""
        data = json.loads(serialized)
        return {
            'u': np.array(data['u']),
            'v': np.array(data['v'])
        }
    
    def hybrid_sign(self, data: bytes, hybrid_key: Dict) -> bytes:
        """Sign using Dilithium"""
        return self.dilithium.sign(data)
    
    def hybrid_verify(self, data: bytes, signature: bytes, hybrid_key: Dict) -> bool:
        """Verify using Dilithium"""
        return self.dilithium.verify(data, signature)
    
    def get_key_metrics(self, hybrid_key: Dict) -> Dict:
        """Get key metrics"""
        return {
            'classical_key_size': 2048,
            'quantum_key_size': self.kyber.params.k * self.kyber.params.n * 12 / 8,
            'hybrid_key_id': hybrid_key.get('hybrid_id', 'unknown'),
            'algorithm': 'RSA-2048 + Kyber-768 + Dilithium',
            'timestamp': datetime.now().isoformat()
        }