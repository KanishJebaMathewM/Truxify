import base64
import os
import json
import logging

from typing import Dict, List, Optional
from dataclasses import dataclass
from datetime import datetime, timezone

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


logger = logging.getLogger(__name__)

NONCE_SIZE = 12
KEY_SIZE = 32
TAG_SIZE = 16


@dataclass
class Attribute:
    name: str
    value: str
    issuer: str


@dataclass
class AccessPolicy:
    expression: str
    attributes: List[str]


class CPABE:
    """
    Attribute-based access control prototype.

    Uses AES-256-GCM for authenticated encryption
    and application-level attribute validation.

    This is not production-grade cryptographic CP-ABE.
    """

    def __init__(self, master_secret: Optional[bytes] = None):

        if master_secret is None:
            master_secret = os.urandom(KEY_SIZE)

        if not isinstance(master_secret, bytes) or len(master_secret) < 32:
            raise ValueError(
                "Master secret must contain at least 32 bytes."
            )

        self.master_secret = master_secret

        logger.info("CP-ABE encryption engine initialized")

    def _derive_key(self, nonce: bytes, context: bytes) -> bytes:

        if len(nonce) != NONCE_SIZE:
            raise ValueError("Invalid nonce length.")

        return HKDF(
            algorithm=hashes.SHA256(),
            length=KEY_SIZE,
            salt=nonce,
            info=b"truxify-cpabe:" + context
        ).derive(self.master_secret)

    @staticmethod
    def _encode(data: bytes) -> str:
        return base64.b64encode(data).decode("utf-8")

    @staticmethod
    def _decode(data: str) -> bytes:

        if not isinstance(data, str):
            raise TypeError("Encoded data must be a string.")

        try:
            return base64.b64decode(data, validate=True)
        except (ValueError, TypeError):
            raise ValueError("Invalid Base64 data.") from None

    @staticmethod
    def _check_attributes(
        user_attributes: List[Attribute],
        required_attributes: List[str]
    ) -> bool:

        if not isinstance(user_attributes, list):
            raise TypeError("User attributes must be a list.")

        if not all(isinstance(attr, Attribute) for attr in user_attributes):
            raise TypeError("Invalid user attribute object.")

        available_attributes = {
            attr.name for attr in user_attributes
        }

        return set(required_attributes).issubset(
            available_attributes
        )

    def _encrypt_key_with_policy(
        self,
        symmetric_key: bytes,
        required_attributes: List[str]
    ) -> str:

        nonce = os.urandom(NONCE_SIZE)

        context = json.dumps(
            sorted(required_attributes),
            separators=(",", ":")
        ).encode("utf-8")

        key = self._derive_key(nonce, context)

        encrypted_key = AESGCM(key).encrypt(
            nonce,
            symmetric_key,
            context
        )

        return self._encode(nonce + encrypted_key)

    def _decrypt_key_with_policy(
        self,
        encrypted_key: str,
        required_attributes: List[str]
    ) -> bytes:

        encrypted = self._decode(encrypted_key)

        if len(encrypted) < NONCE_SIZE + TAG_SIZE:
            raise ValueError("Encrypted key is too short.")

        nonce = encrypted[:NONCE_SIZE]
        ciphertext = encrypted[NONCE_SIZE:]

        context = json.dumps(
            sorted(required_attributes),
            separators=(",", ":")
        ).encode("utf-8")

        key = self._derive_key(nonce, context)

        try:
            return AESGCM(key).decrypt(
                nonce,
                ciphertext,
                context
            )
        except InvalidTag:
            raise ValueError(
                "Key decryption failed."
            ) from None

    def _symmetric_encrypt(
        self,
        plaintext: str,
        symmetric_key: bytes,
        policy: str
    ) -> str:

        nonce = os.urandom(NONCE_SIZE)

        ciphertext = AESGCM(symmetric_key).encrypt(
            nonce,
            plaintext.encode("utf-8"),
            policy.encode("utf-8")
        )

        return self._encode(nonce + ciphertext)

    def _symmetric_decrypt(
        self,
        encrypted_data: str,
        symmetric_key: bytes,
        policy: str
    ) -> str:

        encrypted = self._decode(encrypted_data)

        if len(encrypted) < NONCE_SIZE + TAG_SIZE:
            raise ValueError("Encrypted data is too short.")

        nonce = encrypted[:NONCE_SIZE]
        ciphertext = encrypted[NONCE_SIZE:]

        try:
            plaintext = AESGCM(symmetric_key).decrypt(
                nonce,
                ciphertext,
                policy.encode("utf-8")
            )

            return plaintext.decode("utf-8")

        except (InvalidTag, UnicodeDecodeError):
            raise ValueError(
                "Data decryption failed."
            ) from None

    def encrypt(
        self,
        plaintext: str,
        policy: AccessPolicy
    ) -> Dict:

        if not isinstance(plaintext, str):
            raise TypeError("Plaintext must be a string.")

        if not isinstance(policy, AccessPolicy):
            raise TypeError("Invalid access policy.")

        if not policy.expression.strip():
            raise ValueError("Policy expression cannot be empty.")

        if (
            not isinstance(policy.attributes, list)
            or not policy.attributes
            or not all(
                isinstance(attr, str) and attr.strip()
                for attr in policy.attributes
            )
        ):
            raise ValueError("Invalid required attributes.")

        if len(set(policy.attributes)) != len(policy.attributes):
            raise ValueError("Duplicate policy attributes.")

        try:
            symmetric_key = AESGCM.generate_key(
                bit_length=256
            )

            encrypted_data = self._symmetric_encrypt(
                plaintext,
                symmetric_key,
                policy.expression
            )

            encrypted_key = self._encrypt_key_with_policy(
                symmetric_key,
                policy.attributes
            )

            return {
                "success": True,
                "encrypted_data": encrypted_data,
                "encrypted_key": encrypted_key,
                "policy": policy.expression,
                "attributes": policy.attributes.copy(),
                "timestamp": datetime.now(
                    timezone.utc
                ).isoformat()
            }

        except Exception:
            logger.exception("Encryption failed.")
            raise

    def decrypt(
        self,
        encrypted_data: Dict,
        user_attributes: List[Attribute]
    ) -> Dict:

        if not isinstance(encrypted_data, dict):
            raise TypeError("Encrypted data must be a dictionary.")

        required_fields = {
            "encrypted_data",
            "encrypted_key",
            "policy",
            "attributes"
        }

        if not required_fields.issubset(encrypted_data):
            raise ValueError("Incomplete encrypted document.")

        policy = encrypted_data["policy"]
        required_attributes = encrypted_data["attributes"]

        if not isinstance(policy, str) or not policy.strip():
            raise ValueError("Invalid access policy.")

        if (
            not isinstance(required_attributes, list)
            or not required_attributes
            or not all(
                isinstance(attr, str) and attr.strip()
                for attr in required_attributes
            )
        ):
            raise ValueError("Invalid policy attributes.")

        try:
            if not self._check_attributes(
                user_attributes,
                required_attributes
            ):
                raise PermissionError(
                    "User lacks required attributes."
                )

            symmetric_key = self._decrypt_key_with_policy(
                encrypted_data["encrypted_key"],
                required_attributes
            )

            plaintext = self._symmetric_decrypt(
                encrypted_data["encrypted_data"],
                symmetric_key,
                policy
            )

            return {
                "success": True,
                "plaintext": plaintext,
                "timestamp": datetime.now(
                    timezone.utc
                ).isoformat()
            }

        except Exception:
            logger.exception("Decryption failed.")
            raise
