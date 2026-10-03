import os
import math
from typing import Union

class InsufficientEntropyError(ValueError):
    """Raised when a seed does not meet the minimum entropy requirements."""
    pass

def calculate_entropy(data: Union[bytes, str]) -> float:
    """
    Calculates the Shannon entropy of a byte sequence.
    """
    if isinstance(data, str):
        data = data.encode('utf-8')
    
    if not data:
        return 0.0
    
    byte_counts = {}
    for byte in data:
        byte_counts[byte] = byte_counts.get(byte, 0) + 1
        
    length = len(data)
    entropy = 0.0
    
    for count in byte_counts.values():
        probability = count / length
        entropy -= probability * math.log2(probability)
        
    return entropy * length

def validate_seed_entropy(seed: bytes, min_bits: int = 256) -> None:
    """
    Validates that a seed contains at least the specified number of bits of entropy.
    Raises InsufficientEntropyError if the seed is too short or has low entropy.
    """
    if not isinstance(seed, (bytes, bytearray)):
        raise TypeError("Seed must be a bytes-like object.")
        
    if len(seed) * 8 < min_bits:
        raise InsufficientEntropyError(
            f"Seed length is {len(seed) * 8} bits, which is less than the required {min_bits} bits."
        )
        
    # Additional check: ensure the seed isn't trivially predictable (e.g., all zeros)
    unique_bytes = len(set(seed))
    if unique_bytes < 4 and len(seed) >= 32:
        raise InsufficientEntropyError(
            "Seed has insufficient byte diversity, indicating a potentially weak or predictable source."
        )
