
import base64
import binascii
import json
import os
import re

from typing import Dict, Optional, Set

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from policy_builder import CpAbePolicyBuilder


# --------------------------------------------------
# CRYPTOGRAPHIC CONFIGURATION
# --------------------------------------------------

NONCE_SIZE = 12
TAG_SIZE = 16
KEY_SIZE = 32

ALGORITHM = "AES-256-GCM"
ENVELOPE_VERSION = 2

MAX_POLICY_LENGTH = 4096
MAX_CIPHERTEXT_SIZE = 100 * 1024 * 1024

DEFAULT_KEY_ID = "default"


class CpAbeCipherEngine:
    """
    Policy-gated document encryption engine.

    Uses:
        AES-256-GCM for authenticated encryption.
        HKDF-SHA256 for per-document key derivation.
        PolicyBuilder for attribute authorization.

    IMPORTANT:
        This implementation is not a standalone CP-ABE
        cryptographic construction. Attribute-based access
        is enforced by the policy authorization layer.
    """

    def __init__(self, policy_builder=None):
        self.policy_builder = (
            policy_builder or CpAbePolicyBuilder()
        )

    # --------------------------------------------------
    # VALIDATION
    # --------------------------------------------------

    @staticmethod
    def _validate_policy(policy_str: str) -> str:

        if not isinstance(policy_str, str):
            raise TypeError("Policy must be a string.")

        policy_str = policy_str.strip()

        if not policy_str:
            raise ValueError("Access policy cannot be empty.")

        if len(policy_str) > MAX_POLICY_LENGTH:
            raise ValueError("Access policy is too long.")

        return policy_str

    @staticmethod
    def _validate_document_id(
        document_id: Optional[str]
    ) -> Optional[str]:

        if document_id is None:
            return None

        if not isinstance(document_id, str):
            raise TypeError("Document ID must be a string.")

        if not document_id or len(document_id) > 256:
            raise ValueError("Invalid document ID.")

        return document_id

    @staticmethod
    def _validate_key_id(key_id: str) -> str:

        if not isinstance(key_id, str):
            raise TypeError("Key ID must be a string.")

        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", key_id):
            raise ValueError("Invalid key ID.")

        return key_id

    @staticmethod
    def _validate_attributes(
        user_attributes: Set[str]
    ) -> Set[str]:

        if not isinstance(user_attributes, set):
            raise TypeError(
                "User attributes must be a set."
            )

        if not all(
            isinstance(attr, str) and attr.strip()
            for attr in user_attributes
        ):
            raise TypeError(
                "User attributes must contain non-empty strings."
            )

        return user_attributes

    # --------------------------------------------------
    # MASTER KEY MANAGEMENT
    # --------------------------------------------------

    def _get_master_secret(self, key_id: str) -> bytes:
        """
        Retrieves a master secret using a key identifier.

        Environment variables:
            ABE_MASTER_SECRET_DEFAULT
            ABE_MASTER_SECRET_PRODUCTION
            ABE_MASTER_SECRET_BACKUP

        Falls back to ABE_MASTER_SECRET for the default
        key ID to preserve existing deployments.
        """

        env_name = f"ABE_MASTER_SECRET_{key_id.upper()}"

        master_secret = os.environ.get(env_name)

        if not master_secret and key_id == DEFAULT_KEY_ID:
            master_secret = os.environ.get(
                "ABE_MASTER_SECRET"
            )

        if not master_secret:
            raise RuntimeError(
                f"Master encryption key '{key_id}' "
                "is not configured."
            )

        secret_bytes = master_secret.encode("utf-8")

        # Minimum input length. Use a randomly generated
        # secret with at least 32 bytes of entropy.
        if len(secret_bytes) < KEY_SIZE:
            raise RuntimeError(
                "Master secret must contain at least "
                "32 bytes."
            )

        return secret_bytes

    # --------------------------------------------------
    # AUTHENTICATED METADATA
    # --------------------------------------------------

    @staticmethod
    def _build_aad(
        policy_str: str,
        key_id: str,
        document_id: Optional[str],
    ) -> bytes:
        """
        Binds encryption metadata to the ciphertext.

        Changing the policy, key ID, document ID, or
        envelope version invalidates authentication.
        """

        metadata = {
            "version": ENVELOPE_VERSION,
            "algorithm": ALGORITHM,
            "policy": policy_str,
            "key_id": key_id,
            "document_id": document_id,
        }

        return json.dumps(
            metadata,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode("utf-8")

    # --------------------------------------------------
    # KEY DERIVATION
    # --------------------------------------------------

    def _derive_key(
        self,
        policy_str: str,
        nonce: bytes,
        key_id: str = DEFAULT_KEY_ID,
    ) -> bytes:

        if len(nonce) != NONCE_SIZE:
            raise ValueError("Invalid nonce length.")

        master_secret = self._get_master_secret(key_id)

        return HKDF(
            algorithm=hashes.SHA256(),
            length=KEY_SIZE,
            salt=nonce,
            info=(
                f"truxify-cpabe:v{ENVELOPE_VERSION}:"
                f"{key_id}:{policy_str}"
            ).encode("utf-8"),
        ).derive(master_secret)

    # --------------------------------------------------
    # ENCRYPT DOCUMENT
    # --------------------------------------------------

    def encrypt_document(
        self,
        plaintext_bytes: bytes,
        policy_str: str,
        document_id: Optional[str] = None,
        key_id: str = DEFAULT_KEY_ID,
    ) -> Dict:

        if not isinstance(plaintext_bytes, bytes):
            raise TypeError(
                "Plaintext must be bytes."
            )

        policy_str = self._validate_policy(policy_str)

        document_id = self._validate_document_id(
            document_id
        )

        key_id = self._validate_key_id(key_id)

        if len(plaintext_bytes) > MAX_CIPHERTEXT_SIZE:
            raise ValueError(
                "Document exceeds maximum encryption size."
            )

        # Fresh cryptographically secure nonce.
        nonce = os.urandom(NONCE_SIZE)

        # Derive an independent document encryption key.
        key = self._derive_key(
            policy_str,
            nonce,
            key_id,
        )

        # Authenticate all security-relevant metadata.
        aad = self._build_aad(
            policy_str,
            key_id,
            document_id,
        )

        ciphertext = AESGCM(key).encrypt(
            nonce,
            plaintext_bytes,
            aad,
        )

        # Envelope:
        # nonce (12 bytes) + ciphertext + authentication tag
        encrypted = nonce + ciphertext

        return {
            "version": ENVELOPE_VERSION,
            "algorithm": ALGORITHM,
            "key_id": key_id,
            "policy": policy_str,
            "document_id": document_id,
            "ciphertext_b64": base64.b64encode(
                encrypted
            ).decode("ascii"),
        }

    # --------------------------------------------------
    # DECRYPT DOCUMENT
    # --------------------------------------------------

    def decrypt_document(
        self,
        ciphertext_b64: str,
        policy_str: str,
        user_attributes: Set[str],
        document_id: Optional[str] = None,
        key_id: str = DEFAULT_KEY_ID,
        version: int = ENVELOPE_VERSION,
    ) -> bytes:

        if not isinstance(ciphertext_b64, str):
            raise TypeError(
                "Ciphertext must be a string."
            )

        policy_str = self._validate_policy(policy_str)

        user_attributes = self._validate_attributes(
            user_attributes
        )

        document_id = self._validate_document_id(
            document_id
        )

        key_id = self._validate_key_id(key_id)

        if version != ENVELOPE_VERSION:
            raise ValueError(
                "Unsupported encryption envelope version."
            )

        # Reject oversized encoded input before decoding.
        max_encoded_size = 4 * (
            (NONCE_SIZE + TAG_SIZE + MAX_CIPHERTEXT_SIZE + 2) // 3
        )

        if len(ciphertext_b64) > max_encoded_size:
            raise ValueError("Ciphertext is too large.")

        try:
            encrypted = base64.b64decode(
                ciphertext_b64,
                validate=True,
            )
        except (ValueError, TypeError, binascii.Error):
            raise ValueError(
                "Invalid Base64 ciphertext."
            ) from None

        if len(encrypted) < NONCE_SIZE + TAG_SIZE:
            raise ValueError(
                "Ciphertext is too short."
            )

        if len(encrypted) > (
            NONCE_SIZE + TAG_SIZE + MAX_CIPHERTEXT_SIZE
        ):
            raise ValueError("Ciphertext is too large.")

        # --------------------------------------------------
        # ATTRIBUTE-BASED AUTHORIZATION
        # --------------------------------------------------

        try:
            authorized = (
                self.policy_builder.evaluate_user_attributes(
                    user_attributes,
                    policy_str,
                )
            )
        except Exception:
            # Log the original exception internally.
            raise ValueError(
                "Unable to evaluate access policy."
            ) from None

        if not authorized:
            raise PermissionError(
                "User attributes do not satisfy access policy."
            )

        # --------------------------------------------------
        # CRYPTOGRAPHIC DECRYPTION
        # --------------------------------------------------

        nonce = encrypted[:NONCE_SIZE]
        ciphertext = encrypted[NONCE_SIZE:]

        key = self._derive_key(
            policy_str,
            nonce,
            key_id,
        )

        aad = self._build_aad(
            policy_str,
            key_id,
            document_id,
        )

        try:
            return AESGCM(key).decrypt(
                nonce,
                ciphertext,
                aad,
            )

        except InvalidTag:
            raise ValueError(
                "Decryption failed: authentication "
                "verification failed."
            ) from None


# --------------------------------------------------
# SHARED ENGINE INSTANCE
# --------------------------------------------------

abe_cipher = CpAbeCipherEngine()
