import numpy as np
from typing import List, Union

def safe_polynomial_reduction(coeffs: Union[np.ndarray, List[float]], N: int, q: int) -> np.ndarray:
    """
    Performs polynomial reduction modulo X^N - 1 and modulo q.
    Safely wraps indices using c[i % N] += coeff to prevent out-of-bounds errors
    and ensure valid signature verification.
    
    :param coeffs: The raw polynomial coefficients.
    :param N: The degree of the polynomial ring.
    :param q: The modulus for the coefficients.
    :return: The reduced polynomial as a numpy array.
    """
    if isinstance(coeffs, list):
        coeffs = np.array(coeffs, dtype=float)
        
    result = np.zeros(N, dtype=float)
    
    for i, coeff in enumerate(coeffs):
        # FIXED: Safely wrap indices using modulo N
        wrapped_index = i % N
        result[wrapped_index] = (result[wrapped_index] + coeff) % q
        
    return result

def multiply_polynomials_mod_q(p1: np.ndarray, p2: np.ndarray, N: int, q: int) -> np.ndarray:
    """
    Multiplies two polynomials and reduces the result modulo X^N - 1 and q.
    """
    raw_product = np.convolve(p1, p2, mode='full')
    return safe_polynomial_reduction(raw_product, N, q)
