import hashlib
import json
import base64
import os
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

def _derive_attribute_mask(attributes: List[str]) -> bytes:
    """Derive a deterministic 32-byte mask from the given attribute names."""
    combined = b'\x00' * 32
    for attr in sorted(attributes):
        attr_hash = hashlib.sha256(attr.encode()).digest()
        combined = hashlib.sha256(combined + attr_hash).digest()
    return combined

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
                required_attrs
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
