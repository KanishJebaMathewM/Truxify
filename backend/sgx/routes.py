from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any
import base64
from datetime import datetime
import logging
from sgx_service import SGXService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sgx", tags=["Intel SGX"])

# Initialize SGX service
sgx_service = SGXService()

class EncryptRequest(BaseModel):
    plaintext: str

class DecryptRequest(BaseModel):
    ciphertext: str

class StoreRequest(BaseModel):
    data: str

class RetrieveRequest(BaseModel):
    index: int

class ComputeRequest(BaseModel):
    a: int
    b: int
    operation: str

class AttestationRequest(BaseModel):
    quote: str

@router.post("/init")
async def init_enclave():
    """Initialize SGX enclave"""
    try:
        result = sgx_service.init_enclave()
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Enclave init failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/encrypt")
async def encrypt_data(request: EncryptRequest):
    """Encrypt data inside enclave"""
    try:
        result = sgx_service.encrypt_data(request.plaintext)
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Encryption failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/decrypt")
async def decrypt_data(request: DecryptRequest):
    """Decrypt data inside enclave"""
    try:
        result = sgx_service.decrypt_data(request.ciphertext)
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Decryption failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/store")
async def store_data(request: StoreRequest):
    """Store data securely in enclave"""
    try:
        result = sgx_service.store_data(request.data)
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Store data failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/retrieve")
async def retrieve_data(request: RetrieveRequest):
    """Retrieve data from enclave"""
    try:
        result = sgx_service.retrieve_data(request.index)
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Retrieve data failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/attestation/generate")
async def generate_attestation():
    """Generate SGX attestation quote"""
    try:
        result = sgx_service.get_attestation()
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Attestation generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/attestation/verify")
async def verify_attestation(request: AttestationRequest):
    """Verify SGX attestation quote"""
    try:
        result = sgx_service.verify_attestation(request.quote)
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Attestation verification failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/compute")
async def secure_compute(request: ComputeRequest):
    """Compute securely inside enclave"""
    try:
        result = sgx_service.secure_compute(
            request.a,
            request.b,
            request.operation
        )
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Secure compute failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/random")
async def secure_random():
    """Generate secure random number"""
    try:
        result = sgx_service.secure_random()
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Secure random failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/status")
async def get_enclave_status():
    """Get enclave status"""
    try:
        result = sgx_service.get_enclave_status()
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Status fetch failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/stats")
async def get_sgx_stats():
    """Get SGX service statistics"""
    try:
        stats = sgx_service.get_stats()
        return {
            'success': True,
            'data': stats,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Stats fetch failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))