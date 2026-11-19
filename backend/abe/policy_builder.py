
import re
from typing import Set, Tuple, Optional


Token = Tuple[str, Optional[str]]


class CpAbePolicyBuilder:
    """
    Builds and evaluates CP-ABE boolean policies
    using logistics attributes.
    """

    _TOKEN_PATTERN = re.compile(
        r'(\(|\)|(?<!\S)(?:AND|OR|NOT)(?!\S))',
        re.IGNORECASE,
    )

    def build_trip_document_policy(
        self,
        trip_id: str,
        allowed_role: str = "Driver",
    ) -> str:
        """
        Build a policy allowing access to users who possess
        the specified role and trip ID, or have Admin privileges.
        """
        if not isinstance(trip_id, str) or not trip_id.strip():
            raise ValueError("Trip ID cannot be empty")

        if not isinstance(allowed_role, str) or not allowed_role.strip():
            raise ValueError("Role cannot be empty")

        trip_id = trip_id.strip()
        allowed_role = allowed_role.strip()

        self._validate_policy_component(trip_id, "Trip ID")
        self._validate_policy_component(allowed_role, "Role")

        return (
            f"(Role: {allowed_role} AND TripID: {trip_id}) "
            f"OR Role: Admin"
        )

    @staticmethod
    def _validate_policy_component(value: str, field: str) -> None:
        """Prevent policy syntax from being injected into attributes."""

        if any(char in value for char in "()\r\n"):
            raise ValueError(f"{field} contains invalid characters")

        if re.search(r'(?<!\S)(AND|OR|NOT)(?!\S)', value, re.IGNORECASE):
            raise ValueError(
                f"{field} cannot contain reserved boolean operators"
            )

    def evaluate_user_attributes(
        self,
        user_attributes: Set[str],
        policy_str: str,
    ) -> bool:
        """
        Evaluate a boolean access policy against user attributes.
        """

        if not isinstance(user_attributes, set):
            raise TypeError("User attributes must be a set")

        if not all(isinstance(attr, str) for attr in user_attributes):
            raise TypeError("All user attributes must be strings")

        if not isinstance(policy_str, str) or not policy_str.strip():
            raise ValueError("Policy cannot be empty")

        tokens = self._tokenize(policy_str)

        parser = _BooleanParser(tokens, user_attributes)

        return parser.parse()

    def _tokenize(self, expr: str) -> list[Token]:
        """
        Convert a policy expression into tokens.

        Boolean operators must be standalone words.
        Attribute names and values are treated as complete tokens.
        """

        if not isinstance(expr, str):
            raise TypeError("Policy expression must be a string")

        parts = self._TOKEN_PATTERN.split(expr)

        tokens: list[Token] = []

        for part in parts:
            part = part.strip()

            if not part:
                continue

            if part == "(":
                tokens.append(("LP", None))

            elif part == ")":
                tokens.append(("RP", None))

            elif part.upper() in ("AND", "OR", "NOT"):
                tokens.append((part.upper(), None))

            else:
                tokens.append(("ATTR", part))

        return tokens


class _BooleanParser:
    """
    Recursive-descent parser for boolean access policies.

    Grammar:

        OR      -> AND (OR AND)*
        AND     -> NOT (AND NOT)*
        NOT     -> NOT NOT | PRIMARY
        PRIMARY -> (OR) | ATTR

    Operator precedence:
        1. NOT
        2. AND
        3. OR
    """

    def __init__(
        self,
        tokens: list[Token],
        user_attributes: Set[str],
    ):
        self.tokens = tokens
        self.user = user_attributes
        self.pos = 0

    def _peek(self) -> Token:
        """Return the current token without consuming it."""

        if self.pos < len(self.tokens):
            return self.tokens[self.pos]

        return None, None

    def _advance(self) -> Token:
        """Consume and return the current token."""

        if self.pos >= len(self.tokens):
            raise ValueError("Unexpected end of policy")

        token = self.tokens[self.pos]
        self.pos += 1

        return token

    def parse(self) -> bool:
        """Parse and evaluate the complete policy expression."""

        if not self.tokens:
            raise ValueError("Empty policy")

        result = self._parse_or()

        if self.pos != len(self.tokens):
            raise ValueError("Invalid policy expression")

        return result

    def _parse_or(self) -> bool:
        """Evaluate OR expressions."""

        value = self._parse_and()

        while self._peek()[0] == "OR":
            self._advance()

            right = self._parse_and()

            value = value or right

        return value

    def _parse_and(self) -> bool:
        """Evaluate AND expressions."""

        value = self._parse_not()

        while self._peek()[0] == "AND":
            self._advance()

            right = self._parse_not()

            value = value and right

        return value

    def _parse_not(self) -> bool:
        """Evaluate recursive NOT expressions."""

        if self._peek()[0] == "NOT":
            self._advance()

            return not self._parse_not()

        return self._parse_primary()

    def _parse_primary(self) -> bool:
        """Evaluate attributes or parenthesized expressions."""

        token_type, token_value = self._peek()

        if token_type == "LP":
            self._advance()

            value = self._parse_or()

            if self._peek()[0] != "RP":
                raise ValueError("Missing closing parenthesis")

            self._advance()

            return value

        if token_type == "ATTR":
            self._advance()

            return token_value in self.user

        raise ValueError("Invalid policy expression")


# Initialize the policy builder.
policy_builder = CpAbePolicyBuilder()
