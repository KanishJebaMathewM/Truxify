import secrets
import numpy as np

# Field used across the SMPC stack (matches smpc_service.SecretSharing). A
# 127-bit Mersenne prime keeps secret values and share coordinates out of any
# brute-force range.
DEFAULT_PRIME = 2**127 - 1

class ShamirSmpcEngine:
    """
    Shamir's Secret Sharing (k, n) Threshold Engine for SMPC Joint Fleet Analytics.
    Splits fleet earnings secrets into polynomial shares without raw revenue disclosure.
    """
    def __init__(self, prime: int = DEFAULT_PRIME):
        self.prime = prime

    def split_secret(self, secret: int, k: int = 3, n: int = 5) -> list:
        """Splits integer secret into n polynomial shares with threshold k."""
        coeffs = [secret] + [secrets.randbelow(self.prime - 1) + 1 for _ in range(k - 1)]
        shares = []
        for x in range(1, n + 1):
            y = sum(c * (x ** i) for i, c in enumerate(coeffs)) % self.prime
            shares.append((x, y))
        return shares

    def reconstruct_secret(self, shares: list) -> int:
        """Reconstructs secret using Lagrange Interpolation over finite field."""
        secret = 0
        for i, (x_i, y_i) in enumerate(shares):
            num = 1
            den = 1
            for j, (x_j, _) in enumerate(shares):
                if i != j:
                    num = (num * (-x_j)) % self.prime
                    den = (den * (x_i - x_j)) % self.prime
            lagrange_coeff = (num * pow(den, self.prime - 2, self.prime)) % self.prime
            secret = (secret + y_i * lagrange_coeff) % self.prime
        return secret

smpc_engine = ShamirSmpcEngine()
