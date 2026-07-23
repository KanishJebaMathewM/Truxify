from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any
import base64
import json
from datetime import datetime
import logging
from kyber_core import QuantumSafeKeyExchange

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/kyber", tags=["CRYSTALS-Kyber"])

# Initialize Kyber
kyber = QuantumSafeKeyExchange()

class KeyGenResponse(BaseModel):
    public_key: Dict
    secret_key: Dict

class EncapsulateRequest(BaseModel):
    public_key: Dict

class DecapsulateRequest(BaseModel):
    ciphertext: str
    secret_key: Dict

class HybridEncryptRequest(BaseModel):
    data: str
    public_key: Dict
    cipher_key: str

class HybridDecryptRequest(BaseModel):
    encrypted_data: Dict
    secret_key: Dict
    cipher_key: str

@router.post("/keygen")
async def generate_keypair():
    """Generate Kyber key pair"""
    try:
        keypair = kyber.generate_keypair()
        
        return {
            'success': True,
            'data': {
                'public_key': keypair['public_key'],
                'secret_key': keypair['secret_key'],
                'algorithm': keypair['algorithm'],
                'security_level': keypair['security_level']
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Key generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/encapsulate")
async def encapsulate(request: EncapsulateRequest):
    """Encapsulate shared secret"""
    try:
        result = kyber.encapsulate(request.public_key)
        
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Encapsulation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/decapsulate")
async def decapsulate(request: DecapsulateRequest):
    """Decapsulate shared secret"""
    try:
        result = kyber.decapsulate(request.ciphertext, request.secret_key)
        
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Decapsulation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/hybrid/encrypt")
async def hybrid_encrypt(request: HybridEncryptRequest):
    """Hybrid encryption with Kyber + AES"""
    try:
        data_bytes = request.data.encode()
        cipher_key_bytes = base64.b64decode(request.cipher_key)
        
        result = kyber.hybrid_encrypt(data_bytes, request.public_key, cipher_key_bytes)
        
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Hybrid encryption failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/hybrid/decrypt")
async def hybrid_decrypt(request: HybridDecryptRequest):
    """Hybrid decryption"""
    try:
        cipher_key_bytes = base64.b64decode(request.cipher_key)
        
        decrypted = kyber.hybrid_decrypt(
            request.encrypted_data,
            request.secret_key,
            cipher_key_bytes
        )
        
        return {
            'success': True,
            'data': {
                'decrypted': decrypted.decode(),
                'algorithm': 'Kyber-768 + AES-256'
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Hybrid decryption failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/tls/exchange")
async def tls_key_exchange(client_hello: Dict):
    """Simulate TLS key exchange"""
    try:
        result = kyber.tls_key_exchange(client_hello)
        
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"TLS exchange failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/performance")
async def get_performance():
    """Get performance statistics"""
    try:
        stats = kyber.get_performance_stats()
        
        return {
            'success': True,
            'data': stats,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Performance stats failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))