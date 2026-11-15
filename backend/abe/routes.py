"""FastAPI router exposing CP-ABE, KP-ABE and Decentralized ABE operations."""

import logging
import os
import secrets
from contextlib import contextmanager
from datetime import datetime, timezone
from functools import lru_cache
from typing import Annotated, Any, Dict, Iterator, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, StringConstraints

from abe_core import (
    CPABE,
    KPABE,
    AccessPolicy,
    Attribute,
    DecentralizedABE,
)

logger = logging.getLogger(__name__)

# ------------------------------------------------------------------
# Limits and shared types (requires pydantic v2)
# ------------------------------------------------------------------

MAX_PLAINTEXT_CHARS = 1_000_000
MAX_ATTRIBUTES = 64
MAX_AUTHORITIES = 32

NonBlank = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=256)
]
PolicyExpression = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1024)
]
AttributeList = Annotated[List[NonBlank], Field(min_length=1, max_length=MAX_ATTRIBUTES)]


# ------------------------------------------------------------------
# Authentication
# ------------------------------------------------------------------

def require_api_key(x_api_key: Optional[str] = Header(default=None)) -> None:
    """Reject requests that do not carry the configured API key.

    Fails closed: if ABE_API_KEY is not configured, every request is refused.
    Replace with the project's own auth dependency if one exists.
    """
    expected = os.environ.get("ABE_API_KEY")
    if not expected:
        raise HTTPException(
            status_code=503, detail="API authentication is not configured"
        )
    if not x_api_key or not secrets.compare_digest(
        x_api_key.encode(), expected.encode()
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing API key",
            headers={"WWW-Authenticate": "ApiKey"},
        )


router = APIRouter(
    prefix="/abe",
    tags=["Attribute-Based Encryption"],
    dependencies=[Depends(require_api_key)],
)

# ------------------------------------------------------------------
# ABE systems (lazy, overridable in tests via app.dependency_overrides)
# ------------------------------------------------------------------

@lru_cache(maxsize=1)
def get_cp_abe() -> CPABE:
    return CPABE()


@lru_cache(maxsize=1)
def get_kp_abe() -> KPABE:
    return KPABE()


@lru_cache(maxsize=1)
def get_dabe() -> DecentralizedABE:
    return DecentralizedABE()


# ------------------------------------------------------------------
# Request models
# ------------------------------------------------------------------

class PolicyRequest(BaseModel):
    expression: PolicyExpression
    attributes: AttributeList


class AttributeModel(BaseModel):
    name: NonBlank
    value: str = Field(default="", max_length=256)
    issuer: str = Field(default="", max_length=256)


class EncryptRequest(BaseModel):
    plaintext: str = Field(max_length=MAX_PLAINTEXT_CHARS)
    policy: PolicyRequest


class KPEncryptRequest(BaseModel):
    plaintext: str = Field(max_length=MAX_PLAINTEXT_CHARS)
    attributes: AttributeList


class DecryptRequest(BaseModel):
    encrypted_data: Dict[str, Any]
    user_attributes: List[AttributeModel] = Field(
        min_length=1, max_length=MAX_ATTRIBUTES
    )


class KPDecryptRequest(BaseModel):
    encrypted_data: Dict[str, Any]
    user_key: Dict[str, Any]


class UserKeyRequest(BaseModel):
    attributes: AttributeList


class MultiAuthorityRequest(BaseModel):
    authorities: Annotated[
        List[NonBlank], Field(min_length=1, max_length=MAX_AUTHORITIES)
    ]
    policy: PolicyRequest
    plaintext: str = Field(max_length=MAX_PLAINTEXT_CHARS)


class AddAuthorityRequest(BaseModel):
    authority_id: NonBlank
    public_key: NonBlank


class IssueAttributeRequest(BaseModel):
    authority_id: NonBlank
    attribute: NonBlank
    user: NonBlank


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def success_response(data: Any) -> Dict[str, Any]:
    return {
        "success": True,
        "data": data,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@contextmanager
def error_handling(message: str) -> Iterator[None]:
    """Translate library errors into the right HTTP status.

    Details are logged server-side only; clients get a generic message.
    """
    try:
        yield
    except HTTPException:
        raise
    except PermissionError as exc:
        logger.warning("%s: %s", message, exc)
        raise HTTPException(status_code=403, detail=message) from exc
    except ValueError as exc:
        logger.warning("%s: %s", message, exc)
        raise HTTPException(status_code=400, detail=message) from exc
    except Exception as exc:
        logger.exception("%s", message)
        raise HTTPException(status_code=500, detail=message) from exc


def create_policy(request: PolicyRequest) -> AccessPolicy:
    return AccessPolicy(
        expression=request.expression,
        attributes=request.attributes,
    )


def create_attributes(items: List[AttributeModel]) -> List[Attribute]:
    return [
        Attribute(name=a.name, value=a.value, issuer=a.issuer) for a in items
    ]


# ------------------------------------------------------------------
# CP-ABE
#
# Endpoints are plain `def` so FastAPI runs the CPU-bound crypto in its
# threadpool instead of blocking the event loop.
# ------------------------------------------------------------------

@router.post("/cp-abe/encrypt")
def cp_abe_encrypt(
    request: EncryptRequest, cp_abe: CPABE = Depends(get_cp_abe)
):
    with error_handling("CP-ABE encryption failed"):
        policy = create_policy(request.policy)
        return success_response(cp_abe.encrypt(request.plaintext, policy))


@router.post("/cp-abe/decrypt")
def cp_abe_decrypt(
    request: DecryptRequest, cp_abe: CPABE = Depends(get_cp_abe)
):
    with error_handling("CP-ABE decryption failed"):
        attributes = create_attributes(request.user_attributes)
        return success_response(
            cp_abe.decrypt(request.encrypted_data, attributes)
        )


@router.post("/cp-abe/user-key")
def generate_cp_abe_user_key(
    request: UserKeyRequest, cp_abe: CPABE = Depends(get_cp_abe)
):
    with error_handling("CP-ABE user key generation failed"):
        return success_response(cp_abe.generate_user_key(request.attributes))


# ------------------------------------------------------------------
# KP-ABE
# ------------------------------------------------------------------

@router.post("/kp-abe/encrypt")
def kp_abe_encrypt(
    request: KPEncryptRequest, kp_abe: KPABE = Depends(get_kp_abe)
):
    with error_handling("KP-ABE encryption failed"):
        return success_response(
            kp_abe.encrypt(request.plaintext, request.attributes)
        )


@router.post("/kp-abe/decrypt")
def kp_abe_decrypt(
    request: KPDecryptRequest, kp_abe: KPABE = Depends(get_kp_abe)
):
    with error_handling("KP-ABE decryption failed"):
        return success_response(
            kp_abe.decrypt(request.encrypted_data, request.user_key)
        )


# ------------------------------------------------------------------
# Decentralized ABE (DABE)
# ------------------------------------------------------------------

@router.post("/dabe/authority/add")
def add_authority(
    request: AddAuthorityRequest, dabe: DecentralizedABE = Depends(get_dabe)
):
    with error_handling("Failed to add authority"):
        return success_response(
            dabe.add_authority(request.authority_id, request.public_key)
        )


@router.post("/dabe/attribute/issue")
def issue_attribute(
    request: IssueAttributeRequest, dabe: DecentralizedABE = Depends(get_dabe)
):
    with error_handling("Failed to issue attribute"):
        return success_response(
            dabe.issue_attribute(
                request.authority_id, request.attribute, request.user
            )
        )


@router.post("/dabe/encrypt")
def dabe_encrypt(
    request: MultiAuthorityRequest, dabe: DecentralizedABE = Depends(get_dabe)
):
    with error_handling("DABE encryption failed"):
        policy = create_policy(request.policy)
        return success_response(
            dabe.encrypt(
                plaintext=request.plaintext,
                policy=policy,
                authorities=request.authorities,
            )
        )


# ------------------------------------------------------------------
# Statistics
# ------------------------------------------------------------------

@router.get("/stats")
def get_abe_stats(
    cp_abe: CPABE = Depends(get_cp_abe),
    kp_abe: KPABE = Depends(get_kp_abe),
    dabe: DecentralizedABE = Depends(get_dabe),
):
    with error_handling("Failed to retrieve ABE statistics"):
        return success_response(
            {
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
        )
