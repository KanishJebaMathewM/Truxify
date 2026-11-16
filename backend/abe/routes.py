
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
# Base Request Model
# ------------------------------------------------------------------

class ValidatedRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_validator("*", mode="before")
    @classmethod
    def validate_non_empty_strings(cls, value):
        """Reject empty or whitespace-only string inputs."""

        if isinstance(value, str):
            value = value.strip()

            if not value:
                raise ValueError("String fields cannot be empty")

        elif isinstance(value, list):
            value = [
                item.strip() if isinstance(item, str) else item
                for item in value
            ]

            if any(
                isinstance(item, str) and not item
                for item in value
            ):
                raise ValueError("List entries cannot be empty")

        return value


# ------------------------------------------------------------------
# Request Models
# ------------------------------------------------------------------

class PolicyRequest(ValidatedRequest):
    expression: str = Field(min_length=1, max_length=4096)
    attributes: list[str] = Field(min_length=1, max_length=100)


class EncryptRequest(ValidatedRequest):
    plaintext: str = Field(min_length=1, max_length=1_000_000)
    policy: PolicyRequest


class UserAttributeRequest(ValidatedRequest):
    name: str = Field(min_length=1, max_length=256)
    value: str = Field(default="", max_length=1024)
    issuer: str = Field(default="", max_length=256)


class DecryptRequest(ValidatedRequest):
    encrypted_data: dict[str, Any]
    user_attributes: list[UserAttributeRequest] = Field(
        min_length=1,
        max_length=100,
    )


class KPDecryptRequest(ValidatedRequest):
    encrypted_data: dict[str, Any]
    user_key: dict[str, Any]


class UserKeyRequest(ValidatedRequest):
    attributes: list[str] = Field(min_length=1, max_length=100)


class MultiAuthorityRequest(ValidatedRequest):
    authorities: list[str] = Field(min_length=1, max_length=50)
    policy: PolicyRequest
    plaintext: str = Field(min_length=1, max_length=1_000_000)


class AddAuthorityRequest(ValidatedRequest):
    authority_id: str = Field(min_length=1, max_length=256)
    public_key: str = Field(min_length=1, max_length=16384)


class IssueAttributeRequest(ValidatedRequest):
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


def create_policy(request: PolicyRequest) -> AccessPolicy:
    """Convert an API policy request into an ABE access policy."""

    return AccessPolicy(
        expression=request.expression,
        attributes=request.attributes,
    )


def create_attributes(
    items: list[UserAttributeRequest],
) -> list[Attribute]:
    """Convert API attribute models into ABE Attribute objects."""

    return [
        Attribute(
            name=attr.name,
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
    """Encrypt plaintext using a ciphertext access policy."""

    try:
        policy = create_policy(request.policy)

        result = cp_abe.encrypt(
            request.plaintext,
            policy,
        )

        return success_response(result)

    except Exception as exc:
        handle_exception("CP-ABE encryption failed", exc)


@router.post("/cp-abe/decrypt")
def cp_abe_decrypt(request: DecryptRequest):
    """Decrypt ciphertext using user attributes."""

    try:
        attributes = create_attributes(
            request.user_attributes
        )

        result = cp_abe.decrypt(
            request.encrypted_data,
            attributes,
        )

        return success_response(result)

    except Exception as exc:
        handle_exception("CP-ABE decryption failed", exc)


@router.post("/cp-abe/user-key")
def generate_cp_abe_user_key(request: UserKeyRequest):
    """Generate a CP-ABE user key for specified attributes."""

    try:
        result = cp_abe.generate_user_key(
            request.attributes
        )

        return success_response(result)

    except Exception as exc:
        handle_exception("CP-ABE user key generation failed", exc)


# ------------------------------------------------------------------
# KP-ABE
# ------------------------------------------------------------------

@router.post("/kp-abe/encrypt")
def kp_abe_encrypt(request: EncryptRequest):
    """Encrypt plaintext using KP-ABE attribute parameters."""

    try:
        result = kp_abe.encrypt(
            request.plaintext,
            request.policy.attributes,
        )

        return success_response(result)

    except Exception as exc:
        handle_exception("KP-ABE encryption failed", exc)


@router.post("/kp-abe/decrypt")
def kp_abe_decrypt(request: KPDecryptRequest):
    """Decrypt KP-ABE ciphertext using a policy-bound user key."""

    try:
        result = kp_abe.decrypt(
            request.encrypted_data,
            request.user_key,
        )

        return success_response(result)

    except Exception as exc:
        handle_exception("KP-ABE decryption failed", exc)


# ------------------------------------------------------------------
# DECENTRALIZED ABE (DABE)
# ------------------------------------------------------------------

@router.post("/dabe/authority/add")
def add_authority(request: AddAuthorityRequest):
    """Register a decentralized attribute authority."""

    try:
        result = dabe.add_authority(
            request.authority_id,
            request.public_key,
        )

        return success_response(result)

    except Exception as exc:
        handle_exception("Failed to add authority", exc)


@router.post("/dabe/attribute/issue")
def issue_attribute(request: IssueAttributeRequest):
    """Issue an attribute through a registered authority."""

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
def dabe_encrypt(request: MultiAuthorityRequest):
    """Encrypt plaintext using multiple attribute authorities."""

    try:
        policy = create_policy(request.policy)

        result = dabe.encrypt(
            plaintext=request.plaintext,
            policy=policy,
            authorities=request.authorities,
        )

        return success_response(result)

    except Exception as exc:
        handle_exception("DABE encryption failed", exc)


# ------------------------------------------------------------------
# STATISTICS
# ------------------------------------------------------------------

@router.get("/stats")
def get_abe_stats():
    """
    Return limited operational information.

    Do not expose master keys, secret-key state, or complete
    internal attribute and authority registries publicly.
    """

    try:
        stats = {
            "systems": {
                "cp_abe": "initialized",
                "kp_abe": "initialized",
                "dabe": "initialized",
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
