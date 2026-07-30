from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import json
from datetime import datetime
import logging

from smpc_service import SMPCProtocol

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/smpc", tags=["Secure Multi-Party Computation"])

# Initialize SMPC
smpc = SMPCProtocol()

class PartyRegistration(BaseModel):
    party_id: str
    public_key: str

class SessionRequest(BaseModel):
    parties: List[str]

class DataShareRequest(BaseModel):
    data: Any
    parties: List[str]

class AggregateRequest(BaseModel):
    data_list: List[Any]
    operation: str = "sum"

@router.post("/register")
async def register_party(request: PartyRegistration):
    """Register a party for MPC"""
    try:
        result = smpc.register_party(request.party_id, request.public_key)
        return {
            'success': result,
            'message': 'Party registered' if result else 'Party already registered',
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Party registration failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/session/initiate")
async def initiate_session(request: SessionRequest):
    """Initiate MPC session"""
    try:
        session_id = smpc.initiate_session(request.parties)
        return {
            'success': True,
            'data': {
                'session_id': session_id,
                'parties': request.parties,
                'threshold': smpc.threshold
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Session initiation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/share")
async def share_data(request: DataShareRequest):
    """Share data among parties"""
    try:
        shares = smpc.share_data(request.data, request.parties)
        return {
            'success': True,
            'data': {
                'shares': {k: v.hex() for k, v in shares.items()},
                'parties': len(shares)
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Data sharing failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/aggregate")
async def secure_aggregate(request: AggregateRequest):
    """Securely aggregate data"""
    try:
        result = smpc.secure_aggregate(request.data_list, request.operation)
        return {
            'success': True,
            'data': {
                'result': result,
                'operation': request.operation,
                'items': len(request.data_list)
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Secure aggregation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/stats")
async def get_smpc_stats():
    """Get SMPC statistics"""
    try:
        stats = smpc.get_party_stats()
        return {
            'success': True,
            'data': stats,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Stats fetch failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/session/close")
async def close_session():
    """Close MPC session"""
    try:
        smpc.close_session()
        return {
            'success': True,
            'message': 'Session closed',
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Session close failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))