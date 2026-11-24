
import logging

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

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


# ------------------------------------------------------------------
# Initialize ABE Systems
# ------------------------------------------------------------------

# These instances should be initialized through application lifespan
# management in a larger production deployment.

cp_abe = CPABE()
kp_abe = KPABE()
dabe = DecentralizedABE()


# ------------------------------------------------------------------
# Request Models
# ------------------------------------------------------------------

class PolicyRequest(BaseModel):
    expression: str = Field(min_length=1, max_length=4096)
    attributes: List[str] = Field(min_length=1, max_length=100)


class EncryptRequest(BaseModel):
    plaintext: str = Field(max_length=1_000_000)
    policy: PolicyRequest


class AttributeRequest(BaseModel):
    name: str = Field(min_length=1, max_length=256)
    value: str = Field(default="", max_length=256)
    issuer: str = Field(default="", max_length=256)


class DecryptRequest(BaseModel):
    encrypted_data: Dict[str, Any]
    user_attributes: List[AttributeRequest] = Field(max_length=100)


class KPDecryptRequest(ValidatedRequest):
    encrypted_data: dict[str, Any]
    user_key: dict[str, Any]


class UserKeyRequest(BaseModel):
    attributes: List[str] = Field(min_length=1, max_length=100)


class MultiAuthorityRequest(BaseModel):
    authorities: List[str] = Field(min_length=1, max_length=50)
    policy: PolicyRequest
    plaintext: str = Field(max_length=1_000_000)


class AddAuthorityRequest(BaseModel):
    authority_id: str = Field(min_length=1, max_length=256)
    public_key: str = Field(min_length=1, max_length=8192)


class IssueAttributeRequest(BaseModel):
    authority_id: str = Field(min_length=1, max_length=256)
    attribute: str = Field(min_length=1, max_length=256)
    user: str = Field(min_length=1, max_length=256)


# ------------------------------------------------------------------
# Helper Functions
# ------------------------------------------------------------------

def success_response(data: Any) -> dict[str, Any]:
    """Return a standardized API response."""

    return {
        "success": True,
        "data": data,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def handle_exception(message: str, exc: Exception) -> None:
    """
    Convert internal exceptions into safe HTTP responses.

    Internal exception details are logged but not exposed to clients.
    """

    if isinstance(exc, HTTPException):
        raise exc

    if isinstance(exc, PermissionError):
        logger.warning("%s: access denied", message)

        raise HTTPException(
            status_code=403,
            detail="Access denied",
        ) from exc

    if isinstance(exc, ValueError):
        logger.warning("%s: invalid operation input", message)

        raise HTTPException(
            status_code=400,
            detail="Invalid operation input",
        ) from exc

    logger.exception("%s", message)

    raise HTTPException(
        status_code=500,
        detail=message,
    ) from exc


def validate_text(value: str, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise HTTPException(
            status_code=422,
            detail=f"{field_name} cannot be empty",
        )

    return value.strip()


def create_policy(request: PolicyRequest) -> AccessPolicy:
    expression = validate_text(request.expression, "Policy expression")

    attributes = [
        validate_text(attr, "Policy attribute")
        for attr in request.attributes
    ]

    return AccessPolicy(
        expression=expression,
        attributes=attributes,
    )


def create_attributes(items: List[AttributeRequest]):
    return [
        Attribute(
            name=validate_text(attr.name, "Attribute name"),
            value=attr.value,
            issuer=attr.issuer,
        )
        for attr in items
    ]


# ------------------------------------------------------------------
# CP-ABE
# ------------------------------------------------------------------

@router.post("/cp-abe/encrypt")
def cp_abe_encrypt(request: EncryptRequest):
    try:
        policy = create_policy(request.policy)
        plaintext = validate_text(request.plaintext, "Plaintext")

        result = cp_abe.encrypt(plaintext, policy)

        return success_response(result)

    except HTTPException:
        raise
    except Exception as exc:
        handle_exception("CP-ABE encryption failed", exc)


@router.post("/cp-abe/decrypt")
def cp_abe_decrypt(request: DecryptRequest):
    try:
        attributes = create_attributes(request.user_attributes)

        result = cp_abe.decrypt(
            request.encrypted_data,
            attributes,
        )

        return success_response(result)

    except HTTPException:
        raise
    except Exception as exc:
        handle_exception("CP-ABE decryption failed", exc)


@router.post("/cp-abe/user-key")
def generate_cp_abe_user_key(request: UserKeyRequest):
    try:
        attributes = [
            validate_text(attr, "User attribute")
            for attr in request.attributes
        ]

        result = cp_abe.generate_user_key(attributes)

        return success_response(result)

    except HTTPException:
        raise
    except Exception as exc:
        handle_exception("CP-ABE user key generation failed", exc)


# ------------------------------------------------------------------
# KP-ABE
# ------------------------------------------------------------------

@router.post("/kp-abe/encrypt")
def kp_abe_encrypt(request: EncryptRequest):
    try:
        plaintext = validate_text(request.plaintext, "Plaintext")

        attributes = [
            validate_text(attr, "Policy attribute")
            for attr in request.policy.attributes
        ]

        result = kp_abe.encrypt(
            plaintext,
            attributes,
        )

        return success_response(result)

    except HTTPException:
        raise
    except Exception as exc:
        handle_exception("KP-ABE encryption failed", exc)


@router.post("/kp-abe/decrypt")
def kp_abe_decrypt(request: KPDecryptRequest):
    try:
        result = kp_abe.decrypt(
            request.encrypted_data,
            request.user_key,
        )

        return success_response(result)

    except HTTPException:
        raise
    except Exception as exc:
        handle_exception("KP-ABE decryption failed", exc)


# ------------------------------------------------------------------
# DECENTRALIZED ABE (DABE)
# ------------------------------------------------------------------

@router.post("/dabe/authority/add")
def add_authority(request: AddAuthorityRequest):
    try:
        authority_id = validate_text(
            request.authority_id, "Authority ID"
        )

        result = dabe.add_authority(
            authority_id,
            request.public_key,
        )

        return success_response(result)

    except HTTPException:
        raise
    except Exception as exc:
        handle_exception("Failed to add authority", exc)


@router.post("/dabe/attribute/issue")
def issue_attribute(request: IssueAttributeRequest):
    try:
        result = dabe.issue_attribute(
            validate_text(request.authority_id, "Authority ID"),
            validate_text(request.attribute, "Attribute"),
            validate_text(request.user, "User"),
        )

        return success_response(result)

    except HTTPException:
        raise
    except Exception as exc:
        handle_exception("Failed to issue attribute", exc)


@router.post("/dabe/encrypt")
def dabe_encrypt(request: MultiAuthorityRequest):
    try:
        policy = create_policy(request.policy)

        authorities = [
            validate_text(item, "Authority ID")
            for item in request.authorities
        ]

        plaintext = validate_text(request.plaintext, "Plaintext")

        result = dabe.encrypt(
            plaintext=plaintext,
            policy=policy,
            authorities=authorities,
        )

        return success_response(result)

    except HTTPException:
        raise
    except Exception as exc:
        handle_exception("DABE encryption failed", exc)


# ------------------------------------------------------------------
# STATISTICS
# ------------------------------------------------------------------

@router.get("/stats")
def get_abe_stats():
    try:
        stats = {
            "cp_abe": {
                "total_attributes": len(cp_abe.attributes),
            },
            "kp_abe": {
                "system_initialized": kp_abe is not None,
            },
            "dabe": {
                "total_authorities": len(dabe.authorities),
            },
            "available_operations": [
                "cp-abe",
                "kp-abe",
                "dabe",
            ],
        }

        return success_response(stats)

    except Exception as exc:
        handle_exception("Failed to retrieve ABE statistics", exc)
