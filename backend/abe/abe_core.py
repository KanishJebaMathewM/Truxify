
import base64
import binascii
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

# --------------------------------------------------
# CRYPTOGRAPHIC CONFIGURATION
# --------------------------------------------------

NONCE_SIZE = 12
KEY_SIZE = 32
TAG_SIZE = 16

MAX_DATA_SIZE = 100 * 1024 * 1024


# --------------------------------------------------
# DATA MODELS
# --------------------------------------------------

@dataclass
class Attribute:
    name: str
    value: str
    issuer: str


@dataclass
class AccessPolicy:
    expression: str
    attributes: List[str]


# --------------------------------------------------
# CP-ABE ENGINE
# --------------------------------------------------

class CPABE:
    """
    Attribute-based access control prototype.

    Uses:
        AES-256-GCM for authenticated encryption.
        HKDF-SHA256 for key derivation.
        Application-level attribute validation.

    IMPORTANT:
        This is not a standalone cryptographic CP-ABE
        construction. Attribute authorization is enforced
        by the application layer.
    """

    def __init__(
        self,
        master_secret: Optional[bytes] = None
    ):

        if master_secret is None:
            master_secret = os.urandom(KEY_SIZE)

        if (
            not isinstance(master_secret, bytes)
            or len(master_secret) < KEY_SIZE
        ):
            raise ValueError(
                "Master secret must contain at least 32 bytes."
            )

        self.master_secret = master_secret

        logger.info(
            "CP-ABE encryption engine initialized."
        )

    # --------------------------------------------------
    # VALIDATION
    # --------------------------------------------------

    @staticmethod
    def _validate_policy(
        policy: AccessPolicy
    ) -> AccessPolicy:

        if not isinstance(policy, AccessPolicy):
            raise TypeError("Invalid access policy.")

        if (
            not isinstance(policy.expression, str)
            or not policy.expression.strip()
        ):
            raise ValueError(
                "Policy expression cannot be empty."
            )

        if not isinstance(policy.attributes, list):
            raise TypeError(
                "Policy attributes must be a list."
            )

        if not policy.attributes:
            raise ValueError(
                "Policy must contain at least one attribute."
            )

        if not all(
            isinstance(attr, str) and attr.strip()
            for attr in policy.attributes
        ):
            raise ValueError(
                "Policy attributes must contain non-empty strings."
            )

        attributes = [
            attr.strip() for attr in policy.attributes
        ]

        if len(set(attributes)) != len(attributes):
            raise ValueError(
                "Duplicate policy attributes."
            )

        return AccessPolicy(
            expression=policy.expression.strip(),
            attributes=attributes
        )

    @staticmethod
    def _validate_user_attributes(
        user_attributes: List[Attribute]
    ) -> List[Attribute]:

        if not isinstance(user_attributes, list):
            raise TypeError(
                "User attributes must be a list."
            )

        for attr in user_attributes:

            if not isinstance(attr, Attribute):
                raise TypeError(
                    "Invalid user attribute object."
                )

            if not all(
                isinstance(value, str) and value.strip()
                for value in (
                    attr.name,
                    attr.value,
                    attr.issuer
                )
            ):
                raise ValueError(
                    "Attribute name, value and issuer "
                    "must be non-empty strings."
                )

        return user_attributes

    # --------------------------------------------------
    # KEY DERIVATION
    # --------------------------------------------------

    def _derive_key(
        self,
        nonce: bytes,
        context: bytes
    ) -> bytes:

        if (
            not isinstance(nonce, bytes)
            or len(nonce) != NONCE_SIZE
        ):
            raise ValueError(
                "Invalid nonce length."
            )

        if not isinstance(context, bytes):
            raise TypeError(
                "Key derivation context must be bytes."
            )

        return HKDF(
            algorithm=hashes.SHA256(),
            length=KEY_SIZE,
            salt=nonce,
            info=b"truxify-cpabe:" + context
        ).derive(self.master_secret)

    # --------------------------------------------------
    # BASE64 ENCODING / DECODING
    # --------------------------------------------------

    @staticmethod
    def _encode(data: bytes) -> str:

        if not isinstance(data, bytes):
            raise TypeError(
                "Data to encode must be bytes."
            )

        return base64.b64encode(data).decode("ascii")

    @staticmethod
    def _decode(data: str) -> bytes:

        if not isinstance(data, str):
            raise TypeError(
                "Encoded data must be a string."
            )

        try:
            return base64.b64decode(
                data,
                validate=True
            )

        except (ValueError, TypeError, binascii.Error):
            raise ValueError(
                "Invalid Base64 data."
            ) from None

    # --------------------------------------------------
    # ATTRIBUTE VALIDATION
    # --------------------------------------------------

    @staticmethod
    def _check_attributes(
        user_attributes: List[Attribute],
        required_attributes: List[str]
    ) -> bool:

        user_attributes = CPABE._validate_user_attributes(
            user_attributes
        )

        if not isinstance(required_attributes, list):
            raise TypeError(
                "Required attributes must be a list."
            )

        if not all(
            isinstance(attr, str) and attr.strip()
            for attr in required_attributes
        ):
            raise ValueError(
                "Invalid required attributes."
            )

        available_attributes = {
            attr.name.strip()
            for attr in user_attributes
        }

        required = {
            attr.strip()
            for attr in required_attributes
        }

        return required.issubset(
            available_attributes
        )

    # --------------------------------------------------
    # ENCRYPT SYMMETRIC KEY WITH POLICY
    # --------------------------------------------------

    def _encrypt_key_with_policy(
        self,
        symmetric_key: bytes,
        required_attributes: List[str]
    ) -> str:

        if (
            not isinstance(symmetric_key, bytes)
            or len(symmetric_key) != KEY_SIZE
        ):
            raise ValueError(
                "Invalid symmetric encryption key."
            )

        if not isinstance(required_attributes, list):
            raise TypeError(
                "Required attributes must be a list."
            )

        # Generate a secure random nonce.
        nonce = os.urandom(NONCE_SIZE)

        # Generate key derivation context.
        context = json.dumps(
            sorted(required_attributes),
            separators=(",", ":")
        ).encode("utf-8")

        # Derive wrapping key.
        key = self._derive_key(
            nonce,
            context
        )

        # Encrypt the symmetric key.
        encrypted_key = AESGCM(key).encrypt(
            nonce,
            symmetric_key,
            context
        )

        return self._encode(
            nonce + encrypted_key
        )

    # --------------------------------------------------
    # DECRYPT SYMMETRIC KEY WITH POLICY
    # --------------------------------------------------

    def _decrypt_key_with_policy(
        self,
        encrypted_key: str,
        required_attributes: List[str]
    ) -> bytes:

        encrypted = self._decode(encrypted_key)

        if len(encrypted) < NONCE_SIZE + TAG_SIZE:
            raise ValueError(
                "Encrypted key is too short."
            )

        nonce = encrypted[:NONCE_SIZE]
        ciphertext = encrypted[NONCE_SIZE:]

        context = json.dumps(
            sorted(required_attributes),
            separators=(",", ":")
        ).encode("utf-8")

        key = self._derive_key(
            nonce,
            context
        )

        try:
            symmetric_key = AESGCM(key).decrypt(
                nonce,
                ciphertext,
                context
            )

            if len(symmetric_key) != KEY_SIZE:
                raise ValueError(
                    "Invalid decrypted symmetric key."
                )

            return symmetric_key

        except InvalidTag:
            raise ValueError(
                "Key decryption failed."
            ) from None

    # --------------------------------------------------
    # SYMMETRIC ENCRYPTION
    # --------------------------------------------------

    def _symmetric_encrypt(
        self,
        plaintext: str,
        symmetric_key: bytes,
        policy: str
    ) -> str:

        if not isinstance(plaintext, str):
            raise TypeError(
                "Plaintext must be a string."
            )

        if (
            not isinstance(symmetric_key, bytes)
            or len(symmetric_key) != KEY_SIZE
        ):
            raise ValueError(
                "Invalid symmetric encryption key."
            )

        if not isinstance(policy, str):
            raise TypeError(
                "Policy must be a string."
            )

        plaintext_bytes = plaintext.encode("utf-8")

        if len(plaintext_bytes) > MAX_DATA_SIZE:
            raise ValueError(
                "Document exceeds maximum encryption size."
            )

        nonce = os.urandom(NONCE_SIZE)

        ciphertext = AESGCM(symmetric_key).encrypt(
            nonce,
            plaintext_bytes,
            policy.encode("utf-8")
        )

        return self._encode(
            nonce + ciphertext
        )

    # --------------------------------------------------
    # SYMMETRIC DECRYPTION
    # --------------------------------------------------

    def _symmetric_decrypt(
        self,
        encrypted_data: str,
        symmetric_key: bytes,
        policy: str
    ) -> str:

        if (
            not isinstance(symmetric_key, bytes)
            or len(symmetric_key) != KEY_SIZE
        ):
            raise ValueError(
                "Invalid symmetric encryption key."
            )

        if not isinstance(policy, str):
            raise TypeError(
                "Policy must be a string."
            )

        encrypted = self._decode(encrypted_data)

        if len(encrypted) < NONCE_SIZE + TAG_SIZE:
            raise ValueError(
                "Encrypted data is too short."
            )

        if len(encrypted) > (
            NONCE_SIZE + TAG_SIZE + MAX_DATA_SIZE
        ):
            raise ValueError(
                "Encrypted data is too large."
            )

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

    # --------------------------------------------------
    # ENCRYPT DOCUMENT
    # --------------------------------------------------

    def encrypt(
        self,
        plaintext: str,
        policy: AccessPolicy
    ) -> Dict:

        if not isinstance(plaintext, str):
            raise TypeError(
                "Plaintext must be a string."
            )

        policy = self._validate_policy(policy)

        if len(plaintext.encode("utf-8")) > MAX_DATA_SIZE:
            raise ValueError(
                "Document exceeds maximum encryption size."
            )

        try:
            # Generate a random AES-256 key.
            symmetric_key = AESGCM.generate_key(
                bit_length=256
            )

            # Encrypt the document.
            encrypted_data = self._symmetric_encrypt(
                plaintext,
                symmetric_key,
                policy.expression
            )

            # Encrypt the symmetric key.
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
            logger.exception(
                "Encryption failed."
            )
            raise

    # --------------------------------------------------
    # DECRYPT DOCUMENT
    # --------------------------------------------------

    def decrypt(
        self,
        encrypted_data: Dict,
        user_attributes: List[Attribute]
    ) -> Dict:

        if not isinstance(encrypted_data, dict):
            raise TypeError(
                "Encrypted data must be a dictionary."
            )

        required_fields = {
            "encrypted_data",
            "encrypted_key",
            "policy",
            "attributes"
        }

        if not required_fields.issubset(encrypted_data):
            raise ValueError(
                "Incomplete encrypted document."
            )

        policy = encrypted_data["policy"]
        required_attributes = encrypted_data["attributes"]

        if (
            not isinstance(policy, str)
            or not policy.strip()
        ):
            raise ValueError(
                "Invalid access policy."
            )

        if (
            not isinstance(required_attributes, list)
            or not required_attributes
            or not all(
                isinstance(attr, str) and attr.strip()
                for attr in required_attributes
            )
        ):
            raise ValueError(
                "Invalid policy attributes."
            )

        required_attributes = [
            attr.strip()
            for attr in required_attributes
        ]

        if len(set(required_attributes)) != len(required_attributes):
            raise ValueError(
                "Duplicate policy attributes."
            )

        if not isinstance(encrypted_data["encrypted_key"], str):
            raise TypeError(
                "Encrypted key must be a string."
            )

        if not isinstance(encrypted_data["encrypted_data"], str):
            raise TypeError(
                "Encrypted document must be a string."
            )

        # Validate user attributes.
        user_attributes = self._validate_user_attributes(
            user_attributes
        )

        # --------------------------------------------------
        # ATTRIBUTE-BASED AUTHORIZATION
        # --------------------------------------------------

        if not self._check_attributes(
            user_attributes,
            required_attributes
        ):
            raise PermissionError(
                "User lacks required attributes."
            )

        try:
            # Recover the symmetric encryption key.
            symmetric_key = self._decrypt_key_with_policy(
                encrypted_data["encrypted_key"],
                required_attributes
            )

            # Decrypt the original document.
            plaintext = self._symmetric_decrypt(
                encrypted_data["encrypted_data"],
                symmetric_key,
                policy.strip()
            )

            return {
                "success": True,
                "plaintext": plaintext,
                "timestamp": datetime.now(
                    timezone.utc
                ).isoformat()
            }

        except Exception:
            logger.exception(
                "Decryption failed."
            )
            raise
