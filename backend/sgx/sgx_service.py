import base64
import hashlib
import json
import logging
import os
from typing import Dict, Any, Optional, Tuple
from datetime import datetime
import numpy as np
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

logger = logging.getLogger(__name__)

class SGXService:
    """Intel SGX Confidential Computing Service"""
    
    def __init__(self):
        self.enclave_initialized = False
        self.enclave_id = None
        self.attestation_quote = None
        self.secure_counter = 0

        self._aes_key = self._get_aes_key()

        logger.info("✅ SGX Service initialized")
    
    def init_enclave(self) -> Dict:
        """Initialize SGX enclave"""
        try:
            # In production: create enclave using SGX SDK
            # For demo: simulate initialization
            self.enclave_initialized = True
            self.enclave_id = f"enclave_{int(datetime.now().timestamp())}"
            self.secure_counter = 0
            
            return {
                'success': True,
                'enclave_id': self.enclave_id,
                'status': 'initialized',
                'timestamp': datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"Enclave initialization failed: {e}")
            return {
                'success': False,
                'error': str(e),
                'timestamp': datetime.now().isoformat()
            }
    
    def _get_aes_key(self) -> bytes:
        key = os.environ.get('SGX_ENCRYPTION_KEY')
        if not key:
            raise RuntimeError('SGX_ENCRYPTION_KEY environment variable is required')
        return base64.b64decode(key)

    def encrypt_data(self, plaintext: str) -> Dict:
        try:
            if not self.enclave_initialized:
                return {'success': False, 'error': 'Enclave not initialized'}

            aesgcm = AESGCM(self._aes_key)
            nonce = os.urandom(12)
            plaintext_bytes = plaintext.encode()
            ciphertext = aesgcm.encrypt(nonce, plaintext_bytes, None)

            payload = base64.b64encode(nonce + ciphertext).decode()
            return {
                'success': True,
                'ciphertext': payload,
                'length': len(plaintext_bytes),
                'enclave_id': self.enclave_id,
                'timestamp': datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"Encryption failed: {e}")
            return {'success': False, 'error': str(e)}

    def decrypt_data(self, ciphertext_b64: str) -> Dict:
        try:
            if not self.enclave_initialized:
                return {'success': False, 'error': 'Enclave not initialized'}

            aesgcm = AESGCM(self._aes_key)
            payload = base64.b64decode(ciphertext_b64)
            nonce = payload[:12]
            ciphertext = payload[12:]
            plaintext_bytes = aesgcm.decrypt(nonce, ciphertext, None)

            return {
                'success': True,
                'plaintext': plaintext_bytes.decode(),
                'length': len(plaintext_bytes),
                'enclave_id': self.enclave_id,
                'timestamp': datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"Decryption failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def store_data(self, data: str) -> Dict:
        """Store data securely in enclave"""
        try:
            if not self.enclave_initialized:
                return {'success': False, 'error': 'Enclave not initialized'}
            
            # In production: call ecall_store_data
            # For demo: simulate secure storage
            data_hash = hashlib.sha256(data.encode()).hexdigest()
            
            return {
                'success': True,
                'data_hash': data_hash,
                'storage_index': self.secure_counter,
                'enclave_id': self.enclave_id,
                'timestamp': datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"Store data failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def retrieve_data(self, index: int) -> Dict:
        """Retrieve data from enclave"""
        try:
            if not self.enclave_initialized:
                return {'success': False, 'error': 'Enclave not initialized'}
            
            # In production: call ecall_retrieve_data
            # For demo: return dummy data
            return {
                'success': True,
                'data': f'Secure data from enclave at index {index}',
                'index': index,
                'enclave_id': self.enclave_id,
                'timestamp': datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"Retrieve data failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def get_attestation(self) -> Dict:
        """Get SGX attestation quote"""
        try:
            if not self.enclave_initialized:
                return {'success': False, 'error': 'Enclave not initialized'}
            
            # In production: call ecall_get_quote
            # For demo: generate dummy attestation
            quote = base64.b64encode(b'SGX_ATTESTATION_QUOTE_DUMMY').decode()
            
            return {
                'success': True,
                'quote': quote,
                'enclave_id': self.enclave_id,
                'timestamp': datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"Attestation failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def _parse_quote(self, quote: bytes) -> Optional[Dict]:
        """Parse a SGX ECDSA (DCAP v3) attestation quote.

        Returns the enclave measurement fields, or None when the quote is
        malformed or uses an unsupported format.
        """
        # Header: version(u16), attestation_key_type(u16), reserved(u32)
        if len(quote) < 8:
            return None
        version = int.from_bytes(quote[0:2], "little")
        key_type = int.from_bytes(quote[2:4], "little")
        # Only ECDSA/DCAP v3 quotes are supported here.
        if version != 3 or key_type != 2:
            return None
        # qe3_gid(16) + certification_data_type(u16) + certification_data_size(u32)
        if len(quote) < 30:
            return None
        cert_size = int.from_bytes(quote[26:30], "little")
        body_off = 30 + cert_size
        if body_off + 384 > len(quote):
            return None
        body = quote[body_off:body_off + 384]
        return {
            "version": version,
            "key_type": key_type,
            "mrenclave": body[80:112].hex(),
            "mrsigner": body[144:176].hex(),
            "isv_svn": int.from_bytes(body[274:276], "little"),
        }

    def verify_attestation(self, quote_b64: str) -> Dict:
        """Verify SGX attestation quote"""
        try:
            try:
                quote = base64.b64decode(quote_b64, validate=True)
            except Exception:
                return {
                    'success': True,
                    'verified': False,
                    'reason': 'quote is not valid base64',
                    'timestamp': datetime.now().isoformat()
                }

            # The known demo/dummy quote carries no real evidence and must be
            # rejected so it can never be mistaken for a trusted enclave.
            if quote == b'SGX_ATTESTATION_QUOTE_DUMMY':
                return {
                    'success': True,
                    'verified': False,
                    'reason': 'dummy quote cannot be attested',
                    'timestamp': datetime.now().isoformat()
                }

            parsed = self._parse_quote(quote)
            if parsed is None:
                return {
                    'success': True,
                    'verified': False,
                    'reason': 'malformed or unsupported SGX quote',
                    'timestamp': datetime.now().isoformat()
                }

            # The quote is structurally valid, but a real deployment must also
            # verify the QE/PCK signature chain against the Intel root CA. Until
            # that chain is available we only trust quotes whose measurement
            # matches the pinned enclave identity; everything else is rejected so
            # a forged or unverifiable quote can never be reported as trusted.
            expected_mrenclave = os.environ.get('SGX_EXPECTED_MRENCLAVE')
            if not expected_mrenclave or parsed['mrenclave'] != expected_mrenclave:
                return {
                    'success': True,
                    'verified': False,
                    'reason': 'unverifiable quote: enclave measurement not pinned/matched',
                    'timestamp': datetime.now().isoformat()
                }

            return {
                'success': True,
                'verified': True,
                'mrenclave': parsed['mrenclave'],
                'mrsigner': parsed['mrsigner'],
                'isv_svn': parsed['isv_svn'],
                'quote_hash': hashlib.sha256(quote).hexdigest(),
                'timestamp': datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"Attestation verification failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def secure_compute(self, a: int, b: int, operation: str) -> Dict:
        """Compute securely inside enclave"""
        try:
            if not self.enclave_initialized:
                return {'success': False, 'error': 'Enclave not initialized'}
            
            # In production: call ecall_secure_compute
            # For demo: compute securely
            result = 0
            if operation == '+':
                result = a + b
            elif operation == '-':
                result = a - b
            elif operation == '*':
                result = a * b
            elif operation == '/':
                result = a / b if b != 0 else 0
            
            return {
                'success': True,
                'result': result,
                'operation': operation,
                'enclave_id': self.enclave_id,
                'timestamp': datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"Secure compute failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def secure_random(self) -> Dict:
        """Generate secure random number"""
        try:
            if not self.enclave_initialized:
                return {'success': False, 'error': 'Enclave not initialized'}
            
            # In production: call ecall_secure_random
            # For demo: use a CSPRNG instead of the predictable Mersenne Twister
            import secrets
            random_num = secrets.randbits(32)
            
            return {
                'success': True,
                'random': random_num,
                'enclave_id': self.enclave_id,
                'timestamp': datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"Secure random failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def get_enclave_status(self) -> Dict:
        """Get enclave status"""
        return {
            'initialized': self.enclave_initialized,
            'enclave_id': self.enclave_id,
            'secure_counter': self.secure_counter,
            'timestamp': datetime.now().isoformat()
        }
    
    def get_stats(self) -> Dict:
        """Get SGX service statistics"""
        return {
            'enclave_initialized': self.enclave_initialized,
            'enclave_id': self.enclave_id,
            'secure_counter': self.secure_counter,
            'timestamp': datetime.now().isoformat()
        }