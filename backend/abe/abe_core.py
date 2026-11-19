
import base64
import binascii
import json
import logging
import os

from typing import Dict, List, Optional, Any
from dataclasses import dataclass
from datetime import datetime, timezone

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


logger = logging.getLogger(__name__)

# ==================================================
# CRYPTOGRAPHIC CONFIGURATION
# ==================================================

NONCE_SIZE = 12
KEY_SIZE = 32
TAG_SIZE = 16

ALGORITHM = "AES-256-GCM"
VERSION = 2

MAX_DATA_SIZE = 100 * 1024 * 1024
MAX_POLICY_LENGTH = 4096
MAX_ATTRIBUTES = 256


# ==================================================
# DATA STRUCTURES
# ==================================================

@dataclass
class Attribute:
    name: str
    value: str
    issuer: str


@dataclass
class AccessPolicy:
    expression: str
    attributes: List[str]


# ==================================================
# CP-ABE ENCRYPTION ENGINE
# ==================================================

class CPABE:
    """
    Policy-gated attribute-based encryption prototype.

    AES-256-GCM:
        Authenticated document encryption.

    HKDF-SHA256:
        Encryption key derivation.

    Attribute validation:
        Application-level access control.

    IMPORTANT:
        This implementation is not a standalone
        cryptographic CP-ABE construction.
    """

    def __init__(
        self,
        master_secret: Optional[bytes] = None
    ):

        if master_secret is None:
            master_secret = os.environ.get(
                "ABE_MASTER_SECRET"
            )

            if master_secret is None:
                raise ValueError(
                    "Set ABE_MASTER_SECRET or provide "
                    "a master_secret."
                )

            master_secret = master_secret.encode("utf-8")

        if not isinstance(master_secret, bytes):
            raise TypeError(
                "Master secret must be bytes."
            )

        if len(master_secret) < KEY_SIZE:
            raise ValueError(
                "Master secret must contain at least 32 bytes."
            )

        self.master_secret = master_secret

        logger.info("CP-ABE engine initialized.")

    # ==================================================
    # VALIDATION
    # ==================================================

    @staticmethod
    def _validate_policy(policy: AccessPolicy):

        if not isinstance(policy, AccessPolicy):
            raise TypeError("Invalid access policy.")

        if not isinstance(policy.expression, str):
            raise TypeError("Policy expression must be a string.")

        expression = policy.expression.strip()

        if not expression:
            raise ValueError("Policy expression cannot be empty.")

        if len(expression) > MAX_POLICY_LENGTH:
            raise ValueError("Policy expression is too long.")

        if not isinstance(policy.attributes, list):
            raise TypeError("Policy attributes must be a list.")

        if not policy.attributes:
            raise ValueError("Policy attributes cannot be empty.")

        if len(policy.attributes) > MAX_ATTRIBUTES:
            raise ValueError("Too many policy attributes.")

        if not all(
            isinstance(attr, str) and attr.strip()
            for attr in policy.attributes
        ):
            raise ValueError("Invalid policy attributes.")

        if len(set(policy.attributes)) != len(policy.attributes):
            raise ValueError("Duplicate policy attributes.")

        return expression, policy.attributes.copy()

    @staticmethod
    def _validate_user_attributes(
        user_attributes: List[Attribute]
    ):

        if not isinstance(user_attributes, list):
            raise TypeError("User attributes must be a list.")

        for attr in user_attributes:

            if not isinstance(attr, Attribute):
                raise TypeError("Invalid attribute object.")

            if not all(
                isinstance(value, str) and value.strip()
                for value in (attr.name, attr.value, attr.issuer)
            ):
                raise ValueError("Invalid attribute fields.")

    # ==================================================
    # ATTRIBUTE AUTHORIZATION
    # ==================================================

    @staticmethod
    def _check_attributes(
        user_attributes: List[Attribute],
        required_attributes: List[str]
    ) -> bool:

        available_attributes = {
            attr.name for attr in user_attributes
        }

        return set(required_attributes).issubset(
            available_attributes
        )

    # ==================================================
    # BASE64 ENCODING
    # ==================================================

    @staticmethod
    def _encode(data: bytes) -> str:

        return base64.b64encode(data).decode("ascii")

    @staticmethod
    def _decode(data: str) -> bytes:

        if not isinstance(data, str):
            raise TypeError("Encoded data must be a string.")

        try:
            return base64.b64decode(
                data,
                validate=True
            )

        except (ValueError, TypeError, binascii.Error):
            raise ValueError("Invalid Base64 data.") from None

    # ==================================================
    # AUTHENTICATED METADATA
    # ==================================================

    @staticmethod
    def _build_context(
        policy: str,
        attributes: List[str],
        timestamp: str
    ) -> bytes:

        metadata = {
            "version": VERSION,
            "algorithm": ALGORITHM,
            "policy": policy,
            "attributes": sorted(attributes),
            "timestamp": timestamp
        }

        return json.dumps(
            metadata,
            sort_keys=True,
            separators=(",", ":")
        ).encode("utf-8")

    # ==================================================
    # KEY DERIVATION
    # ==================================================

    def _derive_key(
        self,
        nonce: bytes,
        context: bytes
    ) -> bytes:

        if len(nonce) != NONCE_SIZE:
            raise ValueError("Invalid nonce length.")

        return HKDF(
            algorithm=hashes.SHA256(),
            length=KEY_SIZE,
            salt=nonce,
            info=b"truxify-cpabe:v2:" + context
        ).derive(self.master_secret)

    # ==================================================
    # ENCRYPTION OF SYMMETRIC KEY
    # ==================================================

    def _encrypt_key_with_policy(
        self,
        symmetric_key: bytes,
        context: bytes
    ) -> str:

        nonce = os.urandom(NONCE_SIZE)

        key = self._derive_key(
            nonce,
            context
        )

        encrypted_key = AESGCM(key).encrypt(
            nonce,
            symmetric_key,
            context
        )

        return self._encode(
            nonce + encrypted_key
        )

    # ==================================================
    # DECRYPTION OF SYMMETRIC KEY
    # ==================================================

    def _decrypt_key_with_policy(
        self,
        encrypted_key: str,
        context: bytes
    ) -> bytes:

        encrypted = self._decode(encrypted_key)

        if len(encrypted) < NONCE_SIZE + TAG_SIZE:
            raise ValueError("Encrypted key is too short.")

        nonce = encrypted[:NONCE_SIZE]
        ciphertext = encrypted[NONCE_SIZE:]

        key = self._derive_key(
            nonce,
            context
        )

        try:
            return AESGCM(key).decrypt(
                nonce,
                ciphertext,
                context
            )

        except InvalidTag:
            raise ValueError(
                "Key authentication failed."
            ) from None

    # ==================================================
    # DOCUMENT ENCRYPTION
    # ==================================================

    def _symmetric_encrypt(
        self,
        plaintext: str,
        symmetric_key: bytes,
        context: bytes
    ) -> str:

        nonce = os.urandom(NONCE_SIZE)

        ciphertext = AESGCM(symmetric_key).encrypt(
            nonce,
            plaintext.encode("utf-8"),
            context
        )

        return self._encode(
            nonce + ciphertext
        )

    # ==================================================
    # DOCUMENT DECRYPTION
    # ==================================================

    def _symmetric_decrypt(
        self,
        encrypted_data: str,
        symmetric_key: bytes,
        context: bytes
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
                context
            )

            return plaintext.decode("utf-8")

        except (InvalidTag, UnicodeDecodeError):
            raise ValueError(
                "Data authentication or decoding failed."
            ) from None

    # ==================================================
    # MAIN ENCRYPT FUNCTION
    # ==================================================

    def encrypt(
        self,
        plaintext: str,
        policy: AccessPolicy
    ) -> Dict[str, Any]:

        if not isinstance(plaintext, str):
            raise TypeError("Plaintext must be a string.")

        if len(plaintext.encode("utf-8")) > MAX_DATA_SIZE:
            raise ValueError("Document exceeds maximum size.")

        expression, required_attributes = (
            self._validate_policy(policy)
        )

        try:

            # Generate independent AES-256 document key.
            symmetric_key = AESGCM.generate_key(
                bit_length=256
            )

            timestamp = datetime.now(
                timezone.utc
            ).isoformat()

            # Bind all security-relevant metadata.
            context = self._build_context(
                expression,
                required_attributes,
                timestamp
            )

            # Encrypt document.
            encrypted_data = self._symmetric_encrypt(
                plaintext,
                symmetric_key,
                context
            )

            # Encrypt document key.
            encrypted_key = self._encrypt_key_with_policy(
                symmetric_key,
                context
            )

            return {
                "success": True,
                "version": VERSION,
                "algorithm": ALGORITHM,
                "encrypted_data": encrypted_data,
                "encrypted_key": encrypted_key,
                "policy": expression,
                "attributes": required_attributes,
                "timestamp": timestamp
            }

        except Exception:
            logger.exception("Encryption failed.")
            raise

    # ==================================================
    # MAIN DECRYPT FUNCTION
    # ==================================================

    def decrypt(
        self,
        encrypted_data: Dict[str, Any],
        user_attributes: List[Attribute]
    ) -> Dict[str, Any]:

        if not isinstance(encrypted_data, dict):
            raise TypeError(
                "Encrypted data must be a dictionary."
            )

        required_fields = {
            "success",
            "version",
            "algorithm",
            "encrypted_data",
            "encrypted_key",
            "policy",
            "attributes",
            "timestamp"
        }

        if not required_fields.issubset(encrypted_data):
            raise ValueError(
                "Incomplete encrypted document."
            )

        if encrypted_data["success"] is not True:
            raise ValueError("Invalid encrypted document.")

        if (
            type(encrypted_data["version"]) is not int
            or encrypted_data["version"] != VERSION
        ):
            raise ValueError("Unsupported envelope version.")

        if encrypted_data["algorithm"] != ALGORITHM:
            raise ValueError("Unsupported encryption algorithm.")

        policy = encrypted_data["policy"]
        required_attributes = encrypted_data["attributes"]
        timestamp = encrypted_data["timestamp"]

        if not isinstance(policy, str) or not policy.strip():
            raise ValueError("Invalid access policy.")

        if len(policy) > MAX_POLICY_LENGTH:
            raise ValueError("Access policy is too long.")

        if (
            not isinstance(required_attributes, list)
            or not required_attributes
            or len(required_attributes) > MAX_ATTRIBUTES
            or not all(
                isinstance(attr, str) and attr.strip()
                for attr in required_attributes
            )
        ):
            raise ValueError("Invalid policy attributes.")

        if len(set(required_attributes)) != len(required_attributes):
            raise ValueError("Duplicate policy attributes.")

        if not isinstance(timestamp, str) or not timestamp:
            raise ValueError("Invalid timestamp.")

        self._validate_user_attributes(user_attributes)

        try:

            # Check whether user possesses all required attributes.
            if not self._check_attributes(
                user_attributes,
                required_attributes
            ):
                raise PermissionError(
                    "User lacks required attributes."
                )

            # Reconstruct authenticated metadata.
            context = self._build_context(
                policy,
                required_attributes,
                timestamp
            )

            # Recover document encryption key.
            symmetric_key = self._decrypt_key_with_policy(
                encrypted_data["encrypted_key"],
                context
            )

            if len(symmetric_key) != KEY_SIZE:
                raise ValueError("Invalid document key.")

            # Decrypt document.
            plaintext = self._symmetric_decrypt(
                encrypted_data["encrypted_data"],
                symmetric_key,
                context
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


# ==================================================
# SHARED ENGINE INSTANCE
# ==================================================

# Set ABE_MASTER_SECRET before importing this module
# if you want to create a shared instance.
#
# Otherwise, create CPABE(master_secret=...) explicitly.

