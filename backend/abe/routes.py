from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any
from datetime import datetime, timezone
import logging

from abe_core import (
    CPABE,
    KPABE,
    DecentralizedABE,
    Attribute,
    AccessPolicy,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/abe",
    tags=["Attribute-Based Encryption"],
)

# Initialize ABE systems
cp_abe = CPABE()
kp_abe = KPABE()
dabe = DecentralizedABE()


# Request Models
class PolicyRequest(BaseModel):
    expression: str
    attributes: List[str]


class EncryptRequest(BaseModel):
    plaintext: str
    policy: PolicyRequest


class DecryptRequest(BaseModel):
    encrypted_data: Dict[str, Any]
    user_attributes: List[Dict[str, str]]


class UserKeyRequest(BaseModel):
    attributes: List[str]


class MultiAuthorityRequest(BaseModel):
    authorities: List[str]
    policy: PolicyRequest
    plaintext: str


class AddAuthorityRequest(BaseModel):
    authority_id: str
    public_key: str


class IssueAttributeRequest(BaseModel):
    authority_id: str
    attribute: str
    user: str


# Helper Functions
def success_response(data: Any) -> Dict[str, Any]:
    return {
        "success": True,
        "data": data,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def handle_exception(message: str, exc: Exception):
    logger.exception("%s", message)
    raise HTTPException(
        status_code=500,
        detail=message
    ) from exc


# CP-ABE
@router.post("/cp-abe/encrypt")
async def cp_abe_encrypt(request: EncryptRequest):
    try:
        policy = AccessPolicy(
            expression=request.policy.expression,
            attributes=request.policy.attributes,
        )

        result = cp_abe.encrypt(request.plaintext, policy)
        return success_response(result)

    except Exception as exc:
        handle_exception("CP-ABE encryption failed", exc)


@router.post("/cp-abe/decrypt")
async def cp_abe_decrypt(request: DecryptRequest):
    try:
        user_attributes = [
            Attribute(
                name=attr["name"],
                value=attr.get("value", ""),
                issuer=attr.get("issuer", ""),
            )
            for attr in request.user_attributes
        ]

        result = cp_abe.decrypt(
            request.encrypted_data,
            user_attributes,
        )

        return success_response(result)

    except Exception as exc:
        handle_exception("CP-ABE decryption failed", exc)


@router.post("/cp-abe/user-key")
async def generate_cp_abe_user_key(request: UserKeyRequest):
    try:
        result = cp_abe.generate_user_key(request.attributes)
        return success_response(result)

    except Exception as exc:
        handle_exception("CP-ABE user key generation failed", exc)


# KP-ABE
@router.post("/kp-abe/encrypt")
async def kp_abe_encrypt(request: EncryptRequest):
    try:
        result = kp_abe.encrypt(
            request.plaintext,
            request.policy.attributes,
        )

        return success_response(result)

    except Exception as exc:
        handle_exception("KP-ABE encryption failed", exc)


@router.post("/kp-abe/decrypt")
async def kp_abe_decrypt(request: DecryptRequest):
    try:
        policy = AccessPolicy(
            expression=request.encrypted_data.get("policy", ""),
            attributes=request.encrypted_data.get("attributes", []),
        )

        result = kp_abe.decrypt(
            request.encrypted_data,
            policy,
        )

        return success_response(result)

    except Exception as exc:
        handle_exception("KP-ABE decryption failed", exc)


# Decentralized ABE (DABE)
@router.post("/dabe/authority/add")
async def add_authority(request: AddAuthorityRequest):
    try:
        result = dabe.add_authority(
            request.authority_id,
            request.public_key,
        )

        return success_response(result)

    except Exception as exc:
        handle_exception("Failed to add authority", exc)


@router.post("/dabe/attribute/issue")
async def issue_attribute(request: IssueAttributeRequest):
    try:
        result = dabe.issue_attribute(
            request.authority_id,
            request.attribute,
            request.user,
        )

        return success_response(result)

    except Exception as exc:
        handle_exception("Failed to issue attribute", exc)


@router.post("/dabe/encrypt")
async def dabe_encrypt(request: MultiAuthorityRequest):
    try:
        policy = AccessPolicy(
            expression=request.policy.expression,
            attributes=request.policy.attributes,
        )

        result = dabe.encrypt(
            plaintext=request.plaintext,
            policy=policy,
            authorities=request.authorities,
        )

        return success_response(result)

    except Exception as exc:
        handle_exception("DABE encryption failed", exc)


# Statistics
@router.get("/stats")
async def get_abe_stats():
    try:
        stats = {
            "cp_abe": {
                "attributes": list(cp_abe.attributes.keys()),
                "has_master_key": cp_abe.master_secret is not None,
                "total_attributes": len(cp_abe.attributes),
            },
            "kp_abe": {
                "has_master_key": kp_abe.master_secret is not None,
            },
            "dabe": {
                "authorities": list(dabe.authorities.keys()),
                "total_authorities": len(dabe.authorities),
            },
        }

        return success_response(stats)

    except Exception as exc:
        handle_exception("Failed to retrieve ABE statistics", exc)
