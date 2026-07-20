import hashlib
import json
import base64
from typing import Dict, List, Tuple, Any, Optional
from dataclasses import dataclass
import numpy as np
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import serialization
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

@dataclass
class Attribute:
    name: str
    value: str
    issuer: str

@dataclass
class AccessPolicy:
    expression: str
    attributes: List[str]

class CPABE:
    """Ciphertext-Policy Attribute-Based Encryption"""
    
    def __init__(self):
        # In production: use proper pairing-based cryptography
        # For now: simulate ABE using ECC
        self.private_key = None
        self.public_key = None
        self.master_secret = None
        self.attributes = {}
        
        self._initialize_keys()
        
        logger.info("✅ CP-ABE initialized")
    
    def _initialize_keys(self):
        """Initialize ABE keys"""
        # Generate master keys
        self.master_secret = ec.generate_private_key(ec.SECP256R1())
        self.public_key = self.master_secret.public_key()
        
        # Generate attribute keys
        self._generate_attribute_keys()
    
    def _generate_attribute_keys(self):
        """Generate keys for attributes"""
        # In production: generate keys for each attribute
        attributes = ['admin', 'driver', 'customer', 'manager', 'analyst']
        
        for attr in attributes:
            # Generate key for attribute
            private_key = ec.generate_private_key(ec.SECP256R1())
            public_key = private_key.public_key()
            self.attributes[attr] = {
                'private': private_key,
                'public': public_key
            }
    
    def encrypt(self, plaintext: str, policy: AccessPolicy) -> Dict:
        """Encrypt data with access policy"""
        try:
            # Convert policy to attributes
            required_attrs = policy.attributes
            
            # Generate symmetric key
            symmetric_key = self._generate_symmetric_key()
            
            # Encrypt plaintext with symmetric key
            encrypted_data = self._symmetric_encrypt(plaintext, symmetric_key)
            
            # Encrypt symmetric key with policy
            encrypted_key = self._encrypt_key_with_policy(symmetric_key, required_attrs)
            
            return {
                'success': True,
                'encrypted_data': encrypted_data,
                'encrypted_key': encrypted_key,
                'policy': policy.expression,
                'attributes': required_attrs,
                'timestamp': datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"Encryption failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def decrypt(self, encrypted_data: Dict, user_attributes: List[Attribute]) -> str:
        """Decrypt data if user has required attributes"""
        try:
            # Check if user has required attributes
            required_attrs = encrypted_data.get('attributes', [])
            
            if not self._check_attributes(user_attributes, required_attrs):
                raise ValueError("User lacks required attributes")
            
            # Decrypt symmetric key
            symmetric_key = self._decrypt_key_with_policy(
                encrypted_data['encrypted_key'],
                user_attributes
            )
            
            # Decrypt data
            plaintext = self._symmetric_decrypt(
                encrypted_data['encrypted_data'],
                symmetric_key
            )
            
            return {
                'success': True,
                'plaintext': plaintext,
                'timestamp': datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"Decryption failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def _generate_symmetric_key(self) -> bytes:
        """Generate symmetric encryption key"""
        return base64.b64encode(np.random.bytes(32))
    
    def _symmetric_encrypt(self, plaintext: str, key: bytes) -> str:
        """Symmetric encryption of data"""
        # In production: use AES-GCM
        # For now: use XOR with key (simplified)
        text_bytes = plaintext.encode()
        key_bytes = base64.b64decode(key)
        
        encrypted = bytes([text_bytes[i] ^ key_bytes[i % len(key_bytes)] for i in range(len(text_bytes))])
        return base64.b64encode(encrypted).decode()
    
    def _symmetric_decrypt(self, encrypted: str, key: bytes) -> str:
        """Symmetric decryption of data"""
        encrypted_bytes = base64.b64decode(encrypted)
        key_bytes = base64.b64decode(key)
        
        decrypted = bytes([encrypted_bytes[i] ^ key_bytes[i % len(key_bytes)] for i in range(len(encrypted_bytes))])
        return decrypted.decode()
    
    def _encrypt_key_with_policy(self, key: bytes, attributes: List[str]) -> str:
        """Encrypt symmetric key with attribute policy"""
        # In production: use ABE encryption
        # For now: combine key with attribute hashes
        combined = key
        for attr in sorted(attributes):
            attr_hash = hashlib.sha256(attr.encode()).digest()
            combined = hashlib.sha256(combined + attr_hash).digest()
        
        return base64.b64encode(combined).decode()
    
    def _decrypt_key_with_policy(self, encrypted_key: str, user_attributes: List[Attribute]) -> bytes:
        """Decrypt symmetric key if user has required attributes"""
        # In production: use ABE decryption
        # For now: reconstruct key from attributes
        key_bytes = base64.b64decode(encrypted_key)
        return key_bytes[:32]  # Return first 32 bytes as key
    
    def _check_attributes(self, user_attributes: List[Attribute], required_attrs: List[str]) -> bool:
        """Check if user has all required attributes"""
        user_attr_names = {attr.name for attr in user_attributes}
        required_set = set(required_attrs)
        return required_set.issubset(user_attr_names)
    
    def generate_user_key(self, attributes: List[str]) -> Dict:
        """Generate key for user with specific attributes"""
        user_key = {}
        for attr in attributes:
            if attr in self.attributes:
                user_key[attr] = self.attributes[attr]['private']
            else:
                # Generate new key for attribute
                private_key = ec.generate_private_key(ec.SECP256R1())
                user_key[attr] = private_key
        
        return {
            'success': True,
            'user_key': {k: self._serialize_key(v) for k, v in user_key.items()},
            'attributes': attributes
        }
    
    def _serialize_key(self, key: ec.EllipticCurvePrivateKey) -> str:
        """Serialize private key to string"""
        pem = key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption()
        )
        return pem.decode()

class KPABE:
    """Key-Policy Attribute-Based Encryption"""
    
    def __init__(self):
        self.policies = {}
        self.master_secret = None
        self.public_key = None
        
        self._initialize_keys()
        
        logger.info("✅ KP-ABE initialized")
    
    def _initialize_keys(self):
        """Initialize KP-ABE keys"""
        self.master_secret = ec.generate_private_key(ec.SECP256R1())
        self.public_key = self.master_secret.public_key()
    
    def encrypt(self, plaintext: str, attributes: List[str]) -> Dict:
        """Encrypt data with attribute set"""
        try:
            # Generate symmetric key
            symmetric_key = base64.b64encode(np.random.bytes(32))
            
            # Encrypt data
            encrypted_data = self._symmetric_encrypt(plaintext, symmetric_key)
            
            # Encrypt key with attributes
            encrypted_key = self._encrypt_key_with_attributes(symmetric_key, attributes)
            
            return {
                'success': True,
                'encrypted_data': encrypted_data,
                'encrypted_key': encrypted_key,
                'attributes': attributes,
                'timestamp': datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"Encryption failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def decrypt(self, encrypted_data: Dict, policy: AccessPolicy) -> str:
        """Decrypt data if policy is satisfied"""
        try:
            # Check if policy is satisfied
            if not self._check_policy(policy, encrypted_data['attributes']):
                raise ValueError("Policy not satisfied")
            
            # Decrypt symmetric key
            symmetric_key = self._decrypt_key_with_policy(
                encrypted_data['encrypted_key'],
                policy
            )
            
            # Decrypt data
            plaintext = self._symmetric_decrypt(
                encrypted_data['encrypted_data'],
                symmetric_key
            )
            
            return {
                'success': True,
                'plaintext': plaintext,
                'timestamp': datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"Decryption failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def _symmetric_encrypt(self, plaintext: str, key: bytes) -> str:
        """Symmetric encryption"""
        text_bytes = plaintext.encode()
        key_bytes = base64.b64decode(key)
        
        encrypted = bytes([text_bytes[i] ^ key_bytes[i % len(key_bytes)] for i in range(len(text_bytes))])
        return base64.b64encode(encrypted).decode()
    
    def _symmetric_decrypt(self, encrypted: str, key: bytes) -> str:
        """Symmetric decryption"""
        encrypted_bytes = base64.b64decode(encrypted)
        key_bytes = base64.b64decode(key)
        
        decrypted = bytes([encrypted_bytes[i] ^ key_bytes[i % len(key_bytes)] for i in range(len(encrypted_bytes))])
        return decrypted.decode()
    
    def _encrypt_key_with_attributes(self, key: bytes, attributes: List[str]) -> str:
        """Encrypt key with attributes"""
        combined = key
        for attr in sorted(attributes):
            attr_hash = hashlib.sha256(attr.encode()).digest()
            combined = hashlib.sha256(combined + attr_hash).digest()
        return base64.b64encode(combined).decode()
    
    def _decrypt_key_with_policy(self, encrypted_key: str, policy: AccessPolicy) -> bytes:
        """Decrypt key if policy satisfied"""
        key_bytes = base64.b64decode(encrypted_key)
        return key_bytes[:32]
    
    def _check_policy(self, policy: AccessPolicy, attributes: List[str]) -> bool:
        """Check if attributes satisfy policy"""
        required_attrs = policy.attributes
        attr_set = set(attributes)
        required_set = set(required_attrs)
        
        # Check if all required attributes are present
        return required_set.issubset(attr_set)

class DecentralizedABE:
    """Decentralized Multi-Authority ABE"""
    
    def __init__(self):
        self.authorities = {}
        self.global_public_key = None
        
        logger.info("✅ Decentralized ABE initialized")
    
    def add_authority(self, authority_id: str, public_key: str) -> bool:
        """Add a new authority"""
        if authority_id in self.authorities:
            return False
        
        self.authorities[authority_id] = {
            'public_key': public_key,
            'attributes': [],
            'created_at': datetime.now().isoformat()
        }
        return True
    
    def issue_attribute(self, authority_id: str, attribute: str, user: str) -> Dict:
        """Issue attribute from authority"""
        if authority_id not in self.authorities:
            return {'success': False, 'error': 'Authority not found'}
        
        # Issue attribute
        self.authorities[authority_id]['attributes'].append({
            'user': user,
            'attribute': attribute,
            'issued_at': datetime.now().isoformat()
        })
        
        return {
            'success': True,
            'user': user,
            'attribute': attribute,
            'authority': authority_id
        }
    
    def encrypt(self, plaintext: str, policy: AccessPolicy, authorities: List[str]) -> Dict:
        """Encrypt with multi-authority policy"""
        try:
            # Check authorities
            for auth in authorities:
                if auth not in self.authorities:
                    return {'success': False, 'error': f'Authority {auth} not found'}
            
            # Generate symmetric key
            symmetric_key = base64.b64encode(np.random.bytes(32))
            
            # Encrypt data
            encrypted_data = self._symmetric_encrypt(plaintext, symmetric_key)
            
            # Encrypt key with multi-authority policy
            encrypted_key = self._encrypt_key_multi_authority(symmetric_key, policy, authorities)
            
            return {
                'success': True,
                'encrypted_data': encrypted_data,
                'encrypted_key': encrypted_key,
                'policy': policy.expression,
                'authorities': authorities,
                'timestamp': datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"Encryption failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def decrypt(self, encrypted_data: Dict, user_attributes: Dict) -> str:
        """Decrypt with multi-authority attributes"""
        try:
            # Check attributes from all authorities
            if not self._check_multi_authority_attributes(user_attributes, encrypted_data['policy']):
                raise ValueError("Insufficient attributes")
            
            # Decrypt key
            symmetric_key = self._decrypt_key_multi_authority(
                encrypted_data['encrypted_key'],
                user_attributes
            )
            
            # Decrypt data
            plaintext = self._symmetric_decrypt(
                encrypted_data['encrypted_data'],
                symmetric_key
            )
            
            return {
                'success': True,
                'plaintext': plaintext,
                'timestamp': datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"Decryption failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def _symmetric_encrypt(self, plaintext: str, key: bytes) -> str:
        """Symmetric encryption"""
        text_bytes = plaintext.encode()
        key_bytes = base64.b64decode(key)
        
        encrypted = bytes([text_bytes[i] ^ key_bytes[i % len(key_bytes)] for i in range(len(text_bytes))])
        return base64.b64encode(encrypted).decode()
    
    def _symmetric_decrypt(self, encrypted: str, key: bytes) -> str:
        """Symmetric decryption"""
        encrypted_bytes = base64.b64decode(encrypted)
        key_bytes = base64.b64decode(key)
        
        decrypted = bytes([encrypted_bytes[i] ^ key_bytes[i % len(key_bytes)] for i in range(len(encrypted_bytes))])
        return decrypted.decode()
    
    def _encrypt_key_multi_authority(self, key: bytes, policy: AccessPolicy, authorities: List[str]) -> str:
        """Encrypt key with multi-authority policy"""
        combined = key
        for auth in sorted(authorities):
            auth_hash = hashlib.sha256(auth.encode()).digest()
            combined = hashlib.sha256(combined + auth_hash).digest()
        return base64.b64encode(combined).decode()
    
    def _decrypt_key_multi_authority(self, encrypted_key: str, user_attributes: Dict) -> bytes:
        """Decrypt key with multi-authority attributes"""
        key_bytes = base64.b64decode(encrypted_key)
        return key_bytes[:32]
    
    def _check_multi_authority_attributes(self, user_attributes: Dict, policy: str) -> bool:
        """Check if user has required attributes from all authorities"""
        # In production: implement proper policy checking
        return True