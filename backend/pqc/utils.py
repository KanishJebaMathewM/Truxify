import hashlib
import os
import secrets

def generate_random_bytes(length: int) -> bytes:
    """
    Generate cryptographically secure random bytes.
    """
    return secrets.token_bytes(length)

def hash_data(data: bytes, hash_func=hashlib.sha256) -> bytes:
    """
    Hash arbitrary byte data using the specified hash function.
    Default is SHA-256.
    """
    if not isinstance(data, bytes):
        raise TypeError("Data must be bytes for hashing")
    return hash_func(data).digest()

def xor_bytes(a: bytes, b: bytes) -> bytes:
    """
    Perform bitwise XOR on two byte strings of equal length.
    """
    if len(a) != len(b):
        raise ValueError("Byte strings must be of equal length for XOR")
    return bytes(x ^ y for x, y in zip(a, b))

def derive_key(material: bytes, info: bytes, length: int) -> bytes:
    """
    Derive a key from input material using HKDF-like expansion.
    """
    if length <= 0:
        raise ValueError("Derived key length must be greater than zero")
    
    prk = hash_data(material)
    okm = b""
    t = b""
    counter = 1
    
    while len(okm) < length:
        t = hash_data(t + info + bytes([counter]))
        okm += t
        counter += 1
        
    return okm[:length]

def constant_time_compare(a: bytes, b: bytes) -> bool:
    """
    Compare two byte strings in constant time to prevent timing attacks.
    """
    if len(a) != len(b):
        return False
    result = 0
    for x, y in zip(a, b):
        result |= x ^ y
    return result == 0
