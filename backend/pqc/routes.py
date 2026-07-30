from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, Optional
import json
import base64
from datetime import datetime
import logging
from hybrid_crypto import HybridCrypto

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/pqc", tags=["Post-Quantum Cryptography"])

# Initialize hybrid crypto
hybrid_crypto = HybridCrypto()

class EncryptRequest(BaseModel):
    data: str
    hybrid_key: Optional[Dict] = None

class DecryptRequest(BaseModel):
    ciphertext: Dict
    hybrid_key: Dict

class SignRequest(BaseModel):
    data: str
    hybrid_key: Dict

@router.post("/keygen")
async def generate_hybrid_keys():
    """Generate hybrid key pair"""
    try:
        keys = hybrid_crypto.generate_hybrid_keypair()
        return {
            'success': True,
            'data': {
                'keys': keys,
                'metrics': hybrid_crypto.get_key_metrics(keys)
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Key generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/encrypt")
async def hybrid_encrypt(request: EncryptRequest):
    """Hybrid encrypt data"""
    try:
        # Generate keys if not provided
        if not request.hybrid_key:
            keys = hybrid_crypto.generate_hybrid_keypair()
            hybrid_key = keys
        else:
            hybrid_key = request.hybrid_key
        
        ciphertext = hybrid_crypto.hybrid_encrypt(
            request.data.encode(),
            hybrid_key
        )
        
        return {
            'success': True,
            'data': {
                'ciphertext': ciphertext,
                'key_metrics': hybrid_crypto.get_key_metrics(hybrid_key)
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Encryption failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/decrypt")
async def hybrid_decrypt(request: DecryptRequest):
    """Hybrid decrypt data"""
    try:
        decrypted = hybrid_crypto.hybrid_decrypt(
            request.ciphertext,
            request.hybrid_key
        )
        
        return {
            'success': True,
            'data': {
                'decrypted': decrypted.decode(),
                'key_metrics': hybrid_crypto.get_key_metrics(request.hybrid_key)
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Decryption failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/sign")
async def hybrid_sign(request: SignRequest):
    """Hybrid sign data"""
    try:
        signature = hybrid_crypto.hybrid_sign(
            request.data.encode(),
            request.hybrid_key
        )
        
        return {
            'success': True,
            'data': {
                'signature': base64.b64encode(signature).decode(),
                'key_metrics': hybrid_crypto.get_key_metrics(request.hybrid_key)
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Signing failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/verify")
async def hybrid_verify(request: SignRequest, signature: str):
    """Hybrid verify signature"""
    try:
        signature_bytes = base64.b64decode(signature)
        result = hybrid_crypto.hybrid_verify(
            request.data.encode(),
            signature_bytes,
            request.hybrid_key
        )
        
        return {
            'success': True,
            'data': {
                'verified': result,
                'key_metrics': hybrid_crypto.get_key_metrics(request.hybrid_key)
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Verification failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/metrics")
async def get_key_metrics(hybrid_key: Dict):
    """Get hybrid key metrics"""
    try:
        metrics = hybrid_crypto.get_key_metrics(hybrid_key)
        return {
            'success': True,
            'data': metrics,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Metrics fetch failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))