from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import base64
import json
from datetime import datetime
import logging
from vdf_core import VDFService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/vdf", tags=["Verifiable Delay Functions"])

# Initialize VDF service
vdf_service = VDFService(iterations=100000)

class EvaluateRequest(BaseModel):
    input_data: str  # Base64 encoded

class VerifyRequest(BaseModel):
    input_data: str  # Base64 encoded
    output_data: str
    proof_data: str

class RandomnessRequest(BaseModel):
    seed: str  # Base64 encoded
    length: int = 32

class TransactionRequest(BaseModel):
    tx_data: str  # Base64 encoded

@router.post("/evaluate")
async def evaluate_vdf(request: EvaluateRequest):
    """Evaluate VDF on input"""
    try:
        input_bytes = base64.b64decode(request.input_data)
        result = vdf_service.evaluate(input_bytes)
        
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"VDF evaluation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/verify")
async def verify_vdf(request: VerifyRequest):
    """Verify VDF proof"""
    try:
        input_bytes = base64.b64decode(request.input_data)
        output_bytes = bytes.fromhex(request.output_data)
        proof_bytes = request.proof_data.encode()
        
        result = vdf_service.verify(input_bytes, output_bytes, proof_bytes)
        
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"VDF verification error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/randomness")
async def generate_randomness(request: RandomnessRequest):
    """Generate randomness using VDF"""
    try:
        seed_bytes = base64.b64decode(request.seed)
        result = vdf_service.generate_randomness(seed_bytes, request.length)
        
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Randomness generation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/transaction/protect")
async def protect_transaction(request: TransactionRequest):
    """Protect transaction from front-running"""
    try:
        tx_bytes = base64.b64decode(request.tx_data)
        result = vdf_service.protect_transaction(tx_bytes)
        
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Transaction protection error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/transaction/order")
async def order_transactions():
    """Order transactions by VDF delay"""
    try:
        result = vdf_service.order_transactions()
        
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Transaction ordering error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/stats")
async def get_vdf_stats():
    """Get VDF service statistics"""
    try:
        stats = vdf_service.get_stats()
        
        return {
            'success': True,
            'data': stats,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Stats error: {e}")
        raise HTTPException(status_code=500, detail=str(e))