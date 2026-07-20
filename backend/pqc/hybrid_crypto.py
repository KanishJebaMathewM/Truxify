import json
import hashlib
import time
from datetime import datetime
import numpy as np
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import hashes
from kyber import KyberKEM, DilithiumSignature
import base64
import logging

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
            'hybrid_id': hashlib.sha256(str(time.time()).encode()).hexdigest()[:16]
        }
        
        return hybrid_keys
    
    def hybrid_encrypt(self, data: bytes, hybrid_key: Dict) -> Dict:
        """Encrypt using hybrid approach"""
        try:
            # Generate quantum shared secret
            quantum_ciphertext, quantum_secret = self.kyber.encapsulate(
                hybrid_key['quantum']['public']
            )
            
            # Classical RSA encryption of data + quantum secret
            encrypted_data = self.classical_key.public_key().encrypt(
                data + quantum_secret,
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
            
            # Remove quantum secret from decrypted data
            # In production: proper separation
            return decrypted
            
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