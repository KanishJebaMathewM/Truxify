import base64
import hashlib
from policy_builder import policy_builder

class CpAbeCipherEngine:
    """
    Ciphertext-Policy Attribute-Based Encryption (CP-ABE) Engine for logistics documents.
    """
    def encrypt_document(self, plaintext_bytes: bytes, policy_str: str) -> dict:
        key = hashlib.sha256(policy_str.encode()).digest()
        encrypted = bytes([b ^ key[i % len(key)] for i, b in enumerate(plaintext_bytes)])
        return {
            "policy": policy_str,
            "ciphertext_b64": base64.b64encode(encrypted).decode('utf-8')
        }

    def decrypt_document(self, ciphertext_b64: str, policy_str: str, user_attributes: set) -> bytes:
        if not policy_builder.evaluate_user_attributes(user_attributes, policy_str):
            raise PermissionError("CP-ABE Policy Evaluation Failed: User attributes do not satisfy ciphertext access policy.")

        encrypted = base64.b64decode(ciphertext_b64)
        key = hashlib.sha256(policy_str.encode()).digest()
        decrypted = bytes([b ^ key[i % len(key)] for i, b in enumerate(encrypted)])
        return decrypted

abe_cipher = CpAbeCipherEngine()
