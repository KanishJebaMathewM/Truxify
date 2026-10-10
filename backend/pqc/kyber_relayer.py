"""
Real ML-KEM-1024 (CRYSTALS-Kyber) key-encapsulation relayer service.

Implemented on top of the standards-compliant ``mlkem`` package. Unlike the
previous hash-based construction — where the public key was a pure function of
the secret seed and the ciphertext XORed a keystream derived from the *public*
key, so anyone holding the public key could decrypt the message and derive the
shared secret — this module performs genuine ML-KEM-1024 key encapsulation:
only the holder of the secret key can decapsulate the shared secret.
"""

from mlkem import ML_KEM
from mlkem import ParameterSet
ML_KEM_1024 = ParameterSet.ML_KEM_1024


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
        self._kem = ML_KEM(ML_KEM_1024)

    def generate_keypair(self):
        """Generates an ML-KEM-1024 public/private keypair from a CSPRNG seed.

        Returns ``(public_key_bytes, secret_key_bytes)`` — the mlkem package's
        EncapsKey/DecapsKey objects serialize via to_bytes()."""
        ek, dk = self._kem.key_gen()
        return ek.to_bytes(), dk.to_bytes()

    def encapsulate(self, public_key: bytes):
        """Encapsulates a random 256-bit shared secret using the recipient's Kyber public key.

        Returns ``(ciphertext, shared_secret)``. The shared secret is only
        recoverable by the holder of the corresponding secret key; a party
        that knows only the public key and the ciphertext cannot derive it.
        """
        if len(public_key) != self.public_key_len:
            raise ValueError(f"Invalid Kyber1024 public key length: {len(public_key)} bytes required.")

        # mlkem encaps() takes an EncapsKey — deserialize from bytes.
        from mlkem import EncapsKey
        ek = EncapsKey.from_bytes(public_key)
        shared_secret, ciphertext = self._kem.encaps(ek)
        return ciphertext, shared_secret

    def decapsulate(self, ciphertext: bytes, secret_key: bytes):
        """Decapsulates the shared secret using the recipient's Kyber secret key."""
        if len(ciphertext) != self.ciphertext_len:
            raise ValueError(f"Invalid ciphertext length: {len(ciphertext)} bytes required.")
        if len(secret_key) != self.secret_key_len:
            raise ValueError(f"Invalid secret key length: {len(secret_key)} bytes required.")

        from mlkem import DecapsKey
        dk = DecapsKey.from_bytes(secret_key)
        return self._kem.decaps(dk, ciphertext)


relayer_service = Kyber1024Relayer()
