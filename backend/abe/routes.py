from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime
import logging
from abe_core import CPABE, KPABE, DecentralizedABE, Attribute, AccessPolicy

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/abe", tags=["Attribute-Based Encryption"])

# Initialize ABE systems
cp_abe = CPABE()
kp_abe = KPABE()
dabe = DecentralizedABE()

class PolicyRequest(BaseModel):
    expression: str
    attributes: List[str]

class EncryptRequest(BaseModel):
    plaintext: str
    policy: PolicyRequest

class DecryptRequest(BaseModel):
    encrypted_data: Dict
    user_attributes: List[Dict[str, str]]

class UserKeyRequest(BaseModel):
    attributes: List[str]

class MultiAuthorityRequest(BaseModel):
    authorities: List[str]
    policy: PolicyRequest

@router.post("/cp-abe/encrypt")
async def cp_abe_encrypt(request: EncryptRequest):
    """Encrypt with CP-ABE"""
    try:
        policy = AccessPolicy(
            expression=request.policy.expression,
            attributes=request.policy.attributes
        )
        result = cp_abe.encrypt(request.plaintext, policy)
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"CP-ABE encryption failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/cp-abe/decrypt")
async def cp_abe_decrypt(request: DecryptRequest):
    """Decrypt with CP-ABE"""
    try:
        user_attributes = [
            Attribute(name=attr['name'], value=attr.get('value', ''), issuer=attr.get('issuer', ''))
            for attr in request.user_attributes
        ]
        result = cp_abe.decrypt(request.encrypted_data, user_attributes)
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"CP-ABE decryption failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/cp-abe/user-key")
async def generate_cp_abe_user_key(request: UserKeyRequest):
    """Generate CP-ABE user key"""
    try:
        result = cp_abe.generate_user_key(request.attributes)
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"User key generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/kp-abe/encrypt")
async def kp_abe_encrypt(request: EncryptRequest):
    """Encrypt with KP-ABE"""
    try:
        result = kp_abe.encrypt(request.plaintext, request.policy.attributes)
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"KP-ABE encryption failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/kp-abe/decrypt")
async def kp_abe_decrypt(request: DecryptRequest):
    """Decrypt with KP-ABE"""
    try:
        policy = AccessPolicy(
            expression=request.encrypted_data.get('policy', ''),
            attributes=[attr['name'] for attr in request.user_attributes]
        )
        result = kp_abe.decrypt(request.encrypted_data, policy)
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"KP-ABE decryption failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/dabe/authority/add")
async def add_authority(authority_id: str, public_key: str):
    """Add authority to decentralized ABE"""
    try:
        result = dabe.add_authority(authority_id, public_key)
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Add authority failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/dabe/attribute/issue")
async def issue_attribute(authority_id: str, attribute: str, user: str):
    """Issue attribute from authority"""
    try:
        result = dabe.issue_attribute(authority_id, attribute, user)
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Issue attribute failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/dabe/encrypt")
async def dabe_encrypt(request: MultiAuthorityRequest):
    """Encrypt with decentralized ABE"""
    try:
        policy = AccessPolicy(
            expression=request.policy.expression,
            attributes=request.policy.attributes
        )
        result = dabe.encrypt("test_data", policy, request.authorities)
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"DABE encryption failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/abe/stats")
async def get_abe_stats():
    """Get ABE statistics"""
    try:
        stats = {
            'cp_abe': {
                'attributes': list(cp_abe.attributes.keys()),
                'has_master_key': cp_abe.master_secret is not None
            },
            'kp_abe': {
                'has_master_key': kp_abe.master_secret is not None
            },
            'dabe': {
                'authorities': list(dabe.authorities.keys()),
                'total_authorities': len(dabe.authorities)
            },
            'timestamp': datetime.now().isoformat()
        }
        return {
            'success': True,
            'data': stats,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Stats failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))