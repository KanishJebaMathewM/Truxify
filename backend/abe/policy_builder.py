"""CP-ABE style boolean policy builder and evaluator for logistics attributes."""

import re
from typing import AbstractSet, List, Optional, Tuple

_RESERVED_WORDS = frozenset({"AND", "OR", "NOT"})
_TOKEN_RE = re.compile(r"\(|\)|[^\s()]+")
_ATTR_RE = re.compile(r"^\w+: [\w.\-]+(?: [\w.\-]+)*$")
_VALUE_RE = re.compile(r"^[\w.\-]+(?: [\w.\-]+)*$")
_MAX_DEPTH = 100


def _normalize_attribute(attr: str) -> str:
    """Canonicalize 'Role:Driver' / 'Role :  Driver' -> 'Role: Driver'."""
    attr = " ".join(attr.split())
    return re.sub(r"\s*:\s*", ": ", attr, count=1)


def _validate_value(name: str, value: str) -> str:
    """Reject values that could alter the structure of a policy string."""
    if not isinstance(value, str):
        raise TypeError(f"{name} must be a string")
    value = value.strip()
    if not value:
        raise ValueError(f"{name} cannot be empty")
    if not _VALUE_RE.match(value):
        raise ValueError(f"{name} contains invalid characters: {value!r}")
    if any(word.upper() in _RESERVED_WORDS for word in value.split()):
        raise ValueError(f"{name} cannot contain reserved words (AND/OR/NOT)")
    return value


class CpAbePolicyBuilder:
    """Builds and evaluates CP-ABE boolean policies using logistics attributes.

    Note: this class only builds/evaluates the access-structure (policy);
    it does not perform any cryptographic operations.
    """

    def build_trip_document_policy(
        self, trip_id: str, allowed_role: str = "Driver"
    ) -> str:
        trip_id = _validate_value("Trip ID", trip_id)
        allowed_role = _validate_value("Role", allowed_role)

        return f"(Role: {allowed_role} AND TripID: {trip_id}) OR Role: Admin"

    def evaluate_user_attributes(
        self, user_attributes: AbstractSet[str], policy_str: str
    ) -> bool:
        if not isinstance(user_attributes, (set, frozenset)):
            raise TypeError("User attributes must be a set")
        if not all(isinstance(a, str) for a in user_attributes):
            raise TypeError("Every user attribute must be a string")

        if not isinstance(policy_str, str) or not policy_str.strip():
            raise ValueError("Policy cannot be empty")

        normalized_user = {_normalize_attribute(a) for a in user_attributes}
        tokens = self._tokenize(policy_str)
        return _BooleanParser(tokens, normalized_user).parse()

    def _tokenize(self, expr: str) -> List[Tuple[str, Optional[str]]]:
        """Split into LP, RP, AND, OR, NOT and ATTR tokens.

        Operators are recognised only as standalone whitespace-delimited
        words, so IDs such as 'TRIP-OR-123' stay intact.
        """
        tokens: List[Tuple[str, Optional[str]]] = []
        words: List[str] = []

        def flush():
            if words:
                tokens.append(("ATTR", " ".join(words)))
                words.clear()

        for piece in _TOKEN_RE.findall(expr):
            upper = piece.upper()
            if piece == "(":
                flush()
                tokens.append(("LP", None))
            elif piece == ")":
                flush()
                tokens.append(("RP", None))
            elif upper in _RESERVED_WORDS:
                flush()
                tokens.append((upper, None))
            else:
                words.append(piece)
        flush()
        return tokens


class _BooleanParser:
    """
    Recursive-descent parser.

    Grammar:
        OR      -> AND ('OR' AND)*
        AND     -> NOT ('AND' NOT)*
        NOT     -> 'NOT' NOT | PRIMARY
        PRIMARY -> '(' OR ')' | ATTR
    """

    def __init__(self, tokens, user_attributes):
        self.tokens = tokens
        self.user = user_attributes
        self.pos = 0
        self.depth = 0

    def _peek(self):
        if self.pos < len(self.tokens):
            return self.tokens[self.pos]
        return None, None

    def _advance(self):
        if self.pos >= len(self.tokens):
            raise ValueError("Unexpected end of policy")
        token = self.tokens[self.pos]
        self.pos += 1
        return token

    def _enter(self):
        self.depth += 1
        if self.depth > _MAX_DEPTH:
            raise ValueError("Policy is nested too deeply")

    def parse(self) -> bool:
        if not self.tokens:
            raise ValueError("Empty policy")
        result = self._parse_or()
        if self.pos != len(self.tokens):
            raise ValueError("Invalid policy expression")
        return result

    def _parse_or(self) -> bool:
        value = self._parse_and()
        while self._peek()[0] == "OR":
            self._advance()
            right = self._parse_and()  # always consume the operand
            value = value or right
        return value

    def _parse_and(self) -> bool:
        value = self._parse_not()
        while self._peek()[0] == "AND":
            self._advance()
            right = self._parse_not()  # always consume the operand
            value = value and right
        return value

    def _parse_not(self) -> bool:
        if self._peek()[0] == "NOT":
            self._advance()
            self._enter()
            try:
                return not self._parse_not()
            finally:
                self.depth -= 1
        return self._parse_primary()

    def _parse_primary(self) -> bool:
        token_type, token_value = self._peek()

        if token_type == "LP":
            self._advance()
            self._enter()
            try:
                value = self._parse_or()
            finally:
                self.depth -= 1
            if self._peek()[0] != "RP":
                raise ValueError("Missing closing parenthesis")
            self._advance()
            return value

        if token_type == "ATTR":
            self._advance()
            attr = _normalize_attribute(token_value)
            if not _ATTR_RE.match(attr):
                raise ValueError(f"Malformed attribute in policy: {token_value!r}")
            return attr in self.user

        raise ValueError("Invalid policy expression")


policy_builder = CpAbePolicyBuilder()
