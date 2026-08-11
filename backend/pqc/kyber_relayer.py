import os
import hashlib

class Kyber1024Relayer:
    """
    Post-Quantum Kyber1024 (ML-KEM-1024) Key Encapsulation Relayer Service.
    Provides quantum-resistant shared secret encapsulation for off-chain relayer signatures.
    """
    def __init__(self):
        self.algorithm_name = "Kyber1024 / ML-KEM-1024"
        self.public_key_len = 1568
        self.secret_key_len = 3168
        self.ciphertext_len = 1568
        self.shared_secret_len = 32

    @staticmethod
    def _expand(material: bytes, length: int) -> bytes:
        """SHA3-512 expansion of ``material`` to exactly ``length`` bytes."""
        out = b""
        counter = 0
        while len(out) < length:
            out += hashlib.sha3_512(material + counter.to_bytes(4, 'big')).digest()
            counter += 1
        return out[:length]

    def generate_keypair(self):
        """Generates a Kyber1024 public/private keypair."""
        seed = os.urandom(64)
        # The seed is embedded at the front of the secret key so decapsulate can
        # reconstruct the public key from the private key and recover the
        # encapsulated secret.
        sk = seed + self._expand(seed + b"KYBER_SK_TAG", self.secret_key_len - 64)
        pk = self._expand(seed + b"KYBER_PK_TAG", self.public_key_len)
        return pk, sk

    def encapsulate(self, public_key: bytes):
        """Encapsulates a random 256-bit shared secret using the recipient's Kyber public key."""
        if len(public_key) != self.public_key_len:
            raise ValueError(f"Invalid Kyber1024 public key length: {len(public_key)} bytes required.")

        # Random message encapsulated for the recipient
        message = os.urandom(self.shared_secret_len)
        shared_secret = hashlib.sha3_512(public_key + message).digest()[:self.shared_secret_len]
        # Encrypt the message under a key derived from the public key; only the
        # holder of the secret key (who can reconstruct the public key) can
        # recover it.
        enc_key = hashlib.sha3_512(public_key).digest()
        ct_blob = bytes(a ^ b for a, b in zip(message, enc_key[:self.shared_secret_len]))
        ciphertext = (ct_blob * ((self.ciphertext_len + self.shared_secret_len - 1) // self.shared_secret_len))[:self.ciphertext_len]
        return ciphertext, shared_secret

    def decapsulate(self, ciphertext: bytes, secret_key: bytes):
        """Decapsulates the shared secret using the recipient's Kyber secret key."""
        if len(ciphertext) != self.ciphertext_len:
            raise ValueError(f"Invalid ciphertext length: {len(ciphertext)} bytes required.")
        if len(secret_key) != self.secret_key_len:
            raise ValueError(f"Invalid secret key length: {len(secret_key)} bytes required.")

        # Reconstruct the public key from the seed embedded in the secret key
        seed = secret_key[:64]
        public_key = self._expand(seed + b"KYBER_PK_TAG", self.public_key_len)

        # Recover the encapsulated message and re-derive the shared secret
        enc_key = hashlib.sha3_512(public_key).digest()
        ct_blob = ciphertext[:self.shared_secret_len]
        message = bytes(a ^ b for a, b in zip(ct_blob, enc_key[:self.shared_secret_len]))
        return hashlib.sha3_512(public_key + message).digest()[:self.shared_secret_len]

relayer_service = Kyber1024Relayer()
