
import base64
import binascii
import json
import os
import re

from typing import Dict, Optional, Set, Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from policy_builder import CpAbePolicyBuilder


# ==================================================
# CRYPTOGRAPHIC CONFIGURATION
# ==================================================

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

    AES-256-GCM:
        Authenticated document encryption.

    HKDF-SHA256:
        Derives independent document encryption keys.

    PolicyBuilder:
        Evaluates user attribute authorization.

    Note:
        This is a policy-gated encryption system,
        not a standalone CP-ABE cryptographic scheme.
    """

    def __init__(self, policy_builder=None):
        self.policy_builder = (
            policy_builder if policy_builder is not None
            else CpAbePolicyBuilder()
        )

    # ==================================================
    # VALIDATION
    # ==================================================

    @staticmethod
    def _validate_policy(policy: str) -> str:

        if not isinstance(policy, str):
            raise TypeError("Policy must be a string.")

        policy = policy.strip()

        if not policy:
            raise ValueError("Access policy cannot be empty.")

        if len(policy) > MAX_POLICY_LENGTH:
            raise ValueError("Access policy is too long.")

        return policy

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
    def _validate_attributes(attributes: Set[str]) -> Set[str]:

        if not isinstance(attributes, set):
            raise TypeError("Attributes must be a set.")

        if not all(
            isinstance(attr, str) and attr.strip()
            for attr in attributes
        ):
            raise ValueError("Invalid user attributes.")

        return attributes

    # ==================================================
    # MASTER KEY MANAGEMENT
    # ==================================================

    def _get_master_secret(self, key_id: str) -> bytes:

        env_name = f"ABE_MASTER_SECRET_{key_id.upper()}"

        master_secret = os.environ.get(env_name)

        if not master_secret and key_id == DEFAULT_KEY_ID:
            master_secret = os.environ.get("ABE_MASTER_SECRET")

        if not master_secret:
            raise RuntimeError(
                f"Master encryption key '{key_id}' is not configured."
            )

        secret_bytes = master_secret.encode("utf-8")

        if len(secret_bytes) < KEY_SIZE:
            raise RuntimeError(
                "Master secret must contain at least 32 bytes."
            )

        return secret_bytes

    # ==================================================
    # AUTHENTICATED METADATA
    # ==================================================

    @staticmethod
    def _build_aad(
        policy: str,
        key_id: str,
        document_id: Optional[str]
    ) -> bytes:

        metadata = {
            "version": ENVELOPE_VERSION,
            "algorithm": ALGORITHM,
            "policy": policy,
            "key_id": key_id,
            "document_id": document_id
        }

        return json.dumps(
            metadata,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False
        ).encode("utf-8")

    # ==================================================
    # KEY DERIVATION
    # ==================================================

    def _derive_key(
        self,
        policy: str,
        nonce: bytes,
        key_id: str
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
                f"{key_id}:{policy}"
            ).encode("utf-8")
        ).derive(master_secret)

    # ==================================================
    # ENCRYPTION
    # ==================================================

    def encrypt_document(
        self,
        plaintext_bytes: bytes,
        policy_str: str,
        document_id: Optional[str] = None,
        key_id: str = DEFAULT_KEY_ID
    ) -> Dict[str, Any]:

        if not isinstance(plaintext_bytes, bytes):
            raise TypeError("Plaintext must be bytes.")

        if len(plaintext_bytes) > MAX_CIPHERTEXT_SIZE:
            raise ValueError("Document exceeds maximum size.")

        policy = self._validate_policy(policy_str)
        document_id = self._validate_document_id(document_id)
        key_id = self._validate_key_id(key_id)

        # Generate a fresh random nonce.
        nonce = os.urandom(NONCE_SIZE)

        # Derive document encryption key.
        key = self._derive_key(
            policy,
            nonce,
            key_id
        )

        # Authenticate metadata.
        aad = self._build_aad(
            policy,
            key_id,
            document_id
        )

        # Encrypt using AES-256-GCM.
        encrypted_data = AESGCM(key).encrypt(
            nonce,
            plaintext_bytes,
            aad
        )

        # Combine nonce and encrypted data.
        encrypted = nonce + encrypted_data

        return {
            "version": ENVELOPE_VERSION,
            "algorithm": ALGORITHM,
            "key_id": key_id,
            "policy": policy,
            "document_id": document_id,
            "ciphertext_b64": base64.b64encode(
                encrypted
            ).decode("ascii")
        }

    # ==================================================
    # DECRYPTION
    # ==================================================

    def decrypt_document(
        self,
        envelope: Dict[str, Any],
        user_attributes: Set[str]
    ) -> bytes:

        if not isinstance(envelope, dict):
            raise TypeError("Envelope must be a dictionary.")

        required_fields = {
            "version",
            "algorithm",
            "key_id",
            "policy",
            "document_id",
            "ciphertext_b64"
        }

        if not required_fields.issubset(envelope):
            raise ValueError("Incomplete encryption envelope.")

        version = envelope["version"]

        if type(version) is not int or version != ENVELOPE_VERSION:
            raise ValueError("Unsupported envelope version.")

        if envelope["algorithm"] != ALGORITHM:
            raise ValueError("Unsupported encryption algorithm.")

        policy = self._validate_policy(envelope["policy"])
        key_id = self._validate_key_id(envelope["key_id"])

        document_id = self._validate_document_id(
            envelope["document_id"]
        )

        user_attributes = self._validate_attributes(
            user_attributes
        )

        ciphertext_b64 = envelope["ciphertext_b64"]

        if not isinstance(ciphertext_b64, str):
            raise TypeError("Ciphertext must be a string.")

        max_encoded_size = 4 * (
            (NONCE_SIZE + TAG_SIZE + MAX_CIPHERTEXT_SIZE + 2) // 3
        )

        if len(ciphertext_b64) > max_encoded_size:
            raise ValueError("Ciphertext is too large.")

        # Decode Base64.
        try:
            encrypted = base64.b64decode(
                ciphertext_b64,
                validate=True
            )

        except (ValueError, TypeError, binascii.Error):
            raise ValueError(
                "Invalid Base64 ciphertext."
            ) from None

        if len(encrypted) < NONCE_SIZE + TAG_SIZE:
            raise ValueError("Ciphertext is too short.")

        if len(encrypted) > (
            NONCE_SIZE + TAG_SIZE + MAX_CIPHERTEXT_SIZE
        ):
            raise ValueError("Ciphertext exceeds maximum size.")

        # --------------------------------------------------
        # ATTRIBUTE AUTHORIZATION
        # --------------------------------------------------

        try:
            authorized = (
                self.policy_builder.evaluate_user_attributes(
                    user_attributes,
                    policy
                )
            )

        except Exception:
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
            policy,
            nonce,
            key_id
        )

        aad = self._build_aad(
            policy,
            key_id,
            document_id
        )

        try:
            plaintext = AESGCM(key).decrypt(
                nonce,
                ciphertext,
                aad
            )

            return plaintext

        except InvalidTag:
            raise ValueError(
                "Decryption failed: authentication verification failed."
            ) from None


# ==================================================
# SHARED ENGINE INSTANCE
# ==================================================

abe_cipher = CpAbeCipherEngine()
