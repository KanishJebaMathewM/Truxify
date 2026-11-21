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


NONCE_SIZE = 12
TAG_SIZE = 16
KEY_SIZE = 32

ALGORITHM = "AES-256-GCM"
ENVELOPE_VERSION = 2

MAX_POLICY_LENGTH = 4096
MAX_CIPHERTEXT_SIZE = 100 * 1024 * 1024

DEFAULT_KEY_ID = "default"

KEY_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class CpAbeCipherEngine:
    """
    Policy-gated document encryption engine.

    AES-256-GCM:
        Authenticated document encryption.

    HKDF-SHA256:
        Per-document key derivation.

    CpAbePolicyBuilder:
        Attribute-based authorization.

    IMPORTANT:
        This is not a standalone cryptographic CP-ABE
        implementation. Authorization is enforced by
        the application policy layer.
    """

    def __init__(self, policy_builder=None):

        self.policy_builder = (
            policy_builder if policy_builder is not None
            else CpAbePolicyBuilder()
        )

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

        if not document_id.strip() or len(document_id) > 256:
            raise ValueError("Invalid document ID.")

        return document_id

    @staticmethod
    def _validate_key_id(key_id: str) -> str:
        if not isinstance(key_id, str):
            raise TypeError("Key ID must be a string.")

        if not KEY_ID_PATTERN.fullmatch(key_id):
            raise ValueError("Invalid key ID.")

        return key_id

    @staticmethod
    def _validate_attributes(
        user_attributes: Set[str]
    ) -> Set[str]:

        if not isinstance(user_attributes, set):
            raise TypeError("User attributes must be a set.")

        if any(
            not isinstance(attr, str)
            or not attr.strip()
            for attr in user_attributes
        ):
            raise ValueError(
                "Attributes must contain non-empty strings."
            )

        return {
            attr.strip()
            for attr in user_attributes
        }

    @staticmethod
    def _validate_plaintext(plaintext_bytes: bytes):

        if not isinstance(plaintext_bytes, bytes):
            raise TypeError("Plaintext must be bytes.")

        if len(plaintext_bytes) > MAX_CIPHERTEXT_SIZE:
            raise ValueError(
                "Document exceeds maximum encryption size."
            )

    # --------------------------------------------------
    # MASTER KEY MANAGEMENT
    # --------------------------------------------------

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

    def _derive_key(
        self,
        nonce: bytes,
        key_id: str,
    ) -> bytes:
        if len(nonce) != NONCE_SIZE:
            raise ValueError("Invalid nonce length.")

        master_secret = self._get_master_secret(key_id)

        return HKDF(
            algorithm=hashes.SHA256(),
            length=KEY_SIZE,
            salt=nonce,
            info=(
                f"truxify-document-encryption:"
                f"v{ENVELOPE_VERSION}:{key_id}"
            ).encode("utf-8"),
        ).derive(master_secret)

    def encrypt_document(
        self,
        plaintext_bytes: bytes,
        policy_str: str,
        document_id: Optional[str] = None,
        key_id: str = DEFAULT_KEY_ID
    ) -> Dict[str, Any]:

        self._validate_plaintext(plaintext_bytes)

        policy_str = self._validate_policy(policy_str)

        if len(plaintext_bytes) > MAX_CIPHERTEXT_SIZE:
            raise ValueError("Document exceeds maximum size.")

        policy = self._validate_policy(policy_str)
        document_id = self._validate_document_id(document_id)
        key_id = self._validate_key_id(key_id)

        nonce = os.urandom(NONCE_SIZE)

        key = self._derive_key(
            nonce,
            key_id
        )

        aad = self._build_aad(
            policy,
            key_id,
            document_id
        )

        encrypted_data = AESGCM(key).encrypt(
            nonce,
            plaintext_bytes,
            aad
        )

        encrypted = nonce + ciphertext

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

    def decrypt_document(
        self,
        envelope: Dict,
        user_attributes: Set[str],
    ) -> bytes:

        if not isinstance(envelope, dict):
            raise TypeError("Envelope must be a dictionary.")

        required_fields = {
            "version",
            "algorithm",
            "key_id",
            "policy",
            "document_id",
            "ciphertext_b64",
        }

        if not required_fields.issubset(envelope):
            raise ValueError("Incomplete encryption envelope.")

        version = envelope["version"]

        if (
            isinstance(version, bool)
            or version != ENVELOPE_VERSION
        ):
            raise ValueError("Unsupported envelope version.")

        if envelope["algorithm"] != ALGORITHM:
            raise ValueError("Unsupported encryption algorithm.")

        policy_str = self._validate_policy(
            envelope["policy"]
        )

        key_id = self._validate_key_id(
            envelope["key_id"]
        )

        document_id = self._validate_document_id(
            envelope["document_id"]
        )

        ciphertext_b64 = envelope["ciphertext_b64"]

        if not isinstance(ciphertext_b64, str):
            raise TypeError("Ciphertext must be a string.")

        user_attributes = self._validate_attributes(
            user_attributes
        )

        max_encoded_size = 4 * (
            (NONCE_SIZE + TAG_SIZE + MAX_CIPHERTEXT_SIZE + 2)
            // 3
        )

        if len(ciphertext_b64) > max_encoded_size:
            raise ValueError("Ciphertext is too large.")

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
            raise ValueError("Ciphertext is too large.")

        # --------------------------------------------------
        # ATTRIBUTE AUTHORIZATION
        # --------------------------------------------------

        try:
            authorized = self.policy_builder.evaluate_user_attributes(
                user_attributes,
                policy
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
        # AUTHENTICATED DECRYPTION
        # --------------------------------------------------

        nonce = encrypted[:NONCE_SIZE]

        ciphertext = encrypted[NONCE_SIZE:]

        key = self._derive_key(
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


abe_cipher = CpAbeCipherEngine()
