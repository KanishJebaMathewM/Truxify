import base64
import hashlib
import os

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from policy_builder import policy_builder

# Master secret used to derive per-ciphertext keys. Without it the symmetric key
# was previously derived solely from the (non-secret) access policy string, so
# anyone who knew the policy could recover the plaintext with a single XOR
# (issue #13069). The key is now bound to secret material the decrypting party
# must hold.
MASTER_SECRET = os.environ.get('ABE_MASTER_SECRET')
NONCE_SIZE = 12
TAG_SIZE = 16
KEY_SIZE = 32


class CpAbeCipherEngine:
    """
    Ciphertext-Policy Attribute-Based Encryption (CP-ABE) Engine for logistics documents.

    The policy engine continues to enforce attribute-based access control, while
    document confidentiality now uses a randomized authenticated-encryption
    construction instead of a deterministic repeating XOR stream.
    """

    def _derive_key(self, policy_str: str, nonce: bytes) -> bytes:
        if not MASTER_SECRET:
            raise RuntimeError(
                'ABE_MASTER_SECRET is not configured; refusing to encrypt/decrypt '
                'logistics documents without a master secret key.'
            )

        return HKDF(
            algorithm=hashes.SHA256(),
            length=KEY_SIZE,
            salt=nonce,
            info=f'truxify-cpabe:{policy_str}'.encode('utf-8'),
        ).derive(MASTER_SECRET.encode('utf-8'))

    def encrypt_document(self, plaintext_bytes: bytes, policy_str: str) -> dict:
        nonce = os.urandom(NONCE_SIZE)
        key = self._derive_key(policy_str, nonce)
        ciphertext = AESGCM(key).encrypt(
            nonce,
            plaintext_bytes,
            policy_str.encode('utf-8'),
        )

        # Store nonce + ciphertext + authentication tag in one base64 value.
        encrypted = nonce + ciphertext
        return {
            "policy": policy_str,
            "ciphertext_b64": base64.b64encode(encrypted).decode('utf-8')
        }

    def decrypt_document(self, ciphertext_b64: str, policy_str: str, user_attributes: set) -> bytes:
        if not policy_builder.evaluate_user_attributes(user_attributes, policy_str):
            raise PermissionError("CP-ABE Policy Evaluation Failed: User attributes do not satisfy ciphertext access policy.")

        try:
            encrypted = base64.b64decode(ciphertext_b64, validate=True)
        except (ValueError, TypeError):
            raise ValueError('Invalid base64 ciphertext') from None

        if len(encrypted) < NONCE_SIZE + TAG_SIZE:
            raise ValueError('Ciphertext is too short')

        nonce = encrypted[:NONCE_SIZE]
        ciphertext = encrypted[NONCE_SIZE:]
        key = self._derive_key(policy_str, nonce)

        return AESGCM(key).decrypt(
            nonce,
            ciphertext,
            policy_str.encode('utf-8'),
        )


abe_cipher = CpAbeCipherEngine()
