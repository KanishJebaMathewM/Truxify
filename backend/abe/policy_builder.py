import re
from typing import List, Set


def _tokenize_policy(policy_str: str) -> List[str]:
    """Tokenize a CP-ABE boolean policy into attributes, AND/OR and parens."""
    if not isinstance(policy_str, str):
        raise ValueError("Policy must be a string")
    return [t for t in (p.strip() for p in re.split(r'(\(|\)|\bAND\b|\bOR\b)', policy_str)) if t]


def _eval_or(tokens: List[str], pos: int, user_attributes: set):
    left, pos = _eval_and(tokens, pos, user_attributes)
    while pos < len(tokens) and tokens[pos] == 'OR':
        right, pos = _eval_and(tokens, pos + 1, user_attributes)
        left = left or right
    return left, pos


def _eval_and(tokens: List[str], pos: int, user_attributes: set):
    left, pos = _eval_primary(tokens, pos, user_attributes)
    while pos < len(tokens) and tokens[pos] == 'AND':
        right, pos = _eval_primary(tokens, pos + 1, user_attributes)
        left = left and right
    return left, pos


def _eval_primary(tokens: List[str], pos: int, user_attributes: set):
    if pos >= len(tokens):
        raise ValueError("Unexpected end of policy")
    token = tokens[pos]
    if token == '(':
        value, pos = _eval_or(tokens, pos + 1, user_attributes)
        if pos >= len(tokens) or tokens[pos] != ')':
            raise ValueError("Mismatched parentheses")
        return value, pos + 1
    if token in ('AND', 'OR', ')'):
        raise ValueError(f"Unexpected token: {token}")
    return token in user_attributes, pos + 1


def _evaluate(policy_str: str, user_attributes: set) -> bool:
    """Evaluate a boolean policy string against the user's attribute set.

    Uses a recursive-descent parser with proper AND/OR precedence and
    parenthesis grouping. Fails closed: any policy the parser cannot fully
    consume yields False rather than a permissive partial match.
    """
    tokens = _tokenize_policy(policy_str)
    if not tokens:
        return False
    result, pos = _eval_or(tokens, 0, user_attributes)
    if pos != len(tokens):
        return False
    return bool(result)


class CpAbePolicyBuilder:
    """
    Builds Ciphertext-Policy Attribute-Based Encryption (CP-ABE) boolean policy strings from logistics attributes.
    """
    def build_trip_document_policy(self, trip_id: str, allowed_role: str = "Driver") -> str:
        return f"(Role: {allowed_role} AND TripID: {trip_id}) OR Role: Admin"

    def evaluate_user_attributes(self, user_attributes: set, policy_str: str) -> bool:
        """Evaluates whether user attribute set satisfies CP-ABE boolean expression.

        Parses the full policy with AND/OR precedence and parentheses, so every
        OR alternative is considered. Fails closed on malformed or unparseable
        policies.
        """
        try:
            return _evaluate(policy_str, user_attributes)
        except (ValueError, TypeError, IndexError):
            return False


policy_builder = CpAbePolicyBuilder()
