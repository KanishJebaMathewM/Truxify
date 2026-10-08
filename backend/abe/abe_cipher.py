import base64
import os

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from policy_builder import policy_builder

NONCE_SIZE = 12
TAG_SIZE = 16
KEY_SIZE = 32


class CpAbeCipherEngine:

    def _derive_key(self, policy_str: str, nonce: bytes) -> bytes:
        master_secret = os.environ.get("ABE_MASTER_SECRET")

        if not master_secret:
            raise RuntimeError(
                "ABE_MASTER_SECRET is not configured; refusing to encrypt/decrypt "
                "logistics documents without a master secret key."
            )

        return HKDF(
            algorithm=hashes.SHA256(),
            length=KEY_SIZE,
            salt=nonce,
            info=f"truxify-cpabe:{policy_str}".encode("utf-8"),
        ).derive(master_secret.encode("utf-8"))

    def encrypt_document(self, plaintext_bytes: bytes, policy_str: str) -> dict:
        nonce = os.urandom(NONCE_SIZE)
        key = self._derive_key(policy_str, nonce)

        ciphertext = AESGCM(key).encrypt(
            nonce,
            plaintext_bytes,
            policy_str.encode("utf-8"),
        )

        encrypted = nonce + ciphertext

        return {
            "policy": policy_str,
            "ciphertext_b64": base64.b64encode(encrypted).decode("utf-8"),
        }

    def decrypt_document(
        self,
        ciphertext_b64: str,
        policy_str: str,
        user_attributes: set,
    ) -> bytes:

        if not policy_builder.evaluate_user_attributes(
            user_attributes, policy_str
        ):
            raise PermissionError(
                "CP-ABE Policy Evaluation Failed: "
                "User attributes do not satisfy ciphertext access policy."
            )

        try:
            encrypted = base64.b64decode(
                ciphertext_b64,
                validate=True,
            )
        except (ValueError, TypeError):
            raise ValueError("Invalid base64 ciphertext") from None

        if len(encrypted) < NONCE_SIZE + TAG_SIZE:
            raise ValueError("Ciphertext is too short")

        nonce = encrypted[:NONCE_SIZE]
        ciphertext = encrypted[NONCE_SIZE:]

        key = self._derive_key(policy_str, nonce)

        return AESGCM(key).decrypt(
            nonce,
            ciphertext,
            policy_str.encode("utf-8"),
        )


abe_cipher = CpAbeCipherEngine()
