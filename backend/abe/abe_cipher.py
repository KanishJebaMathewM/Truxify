import base64
import hashlib
import os
from policy_builder import policy_builder

# Master secret used to derive per-ciphertext keys. Without it the symmetric key
# was previously derived solely from the (non-secret) access policy string, so
# anyone who knew the policy could recover the plaintext with a single XOR
# (issue #13069). The key is now bound to secret material the decrypting party
# must hold.
MASTER_SECRET = os.environ.get('ABE_MASTER_SECRET')

class CpAbeCipherEngine:
    """
    Ciphertext-Policy Attribute-Based Encryption (CP-ABE) Engine for logistics documents.
    """
    def _derive_key(self, policy_str: str) -> bytes:
        if not MASTER_SECRET:
            raise RuntimeError(
                'ABE_MASTER_SECRET is not configured; refusing to encrypt/decrypt '
                'logistics documents without a master secret key.'
            )
        return hashlib.sha256((MASTER_SECRET + ':' + policy_str).encode()).digest()

    def encrypt_document(self, plaintext_bytes: bytes, policy_str: str) -> dict:
        key = self._derive_key(policy_str)
        encrypted = bytes([b ^ key[i % len(key)] for i, b in enumerate(plaintext_bytes)])
        return {
            "policy": policy_str,
            "ciphertext_b64": base64.b64encode(encrypted).decode('utf-8')
        }

    def decrypt_document(self, ciphertext_b64: str, policy_str: str, user_attributes: set) -> bytes:
        if not policy_builder.evaluate_user_attributes(user_attributes, policy_str):
            raise PermissionError("CP-ABE Policy Evaluation Failed: User attributes do not satisfy ciphertext access policy.")

        key = self._derive_key(policy_str)
        encrypted = base64.b64decode(ciphertext_b64)
        decrypted = bytes([b ^ key[i % len(key)] for i, b in enumerate(encrypted)])
        return decrypted

abe_cipher = CpAbeCipherEngine()
