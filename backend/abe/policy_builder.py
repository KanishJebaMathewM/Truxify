
class CpAbePolicyBuilder:
    """
    Builds and evaluates CP-ABE boolean policies
    using logistics attributes.
    """

    def build_trip_document_policy(
        self, trip_id: str, allowed_role: str = "Driver"
    ) -> str:
        if not trip_id or not allowed_role:
            raise ValueError("Trip ID and role cannot be empty")

        return f"(Role: {allowed_role} AND TripID: {trip_id}) OR Role: Admin"

    def evaluate_user_attributes(
        self, user_attributes: set, policy_str: str
    ) -> bool:
        if not isinstance(user_attributes, set):
            raise TypeError("User attributes must be a set")

        if not isinstance(policy_str, str) or not policy_str.strip():
            raise ValueError("Policy cannot be empty")

        tokens = self._tokenize(policy_str)
        parser = _BooleanParser(tokens, user_attributes)
        return parser.parse()

    def _tokenize(self, expr):
        import re

        pattern = r'\s*(\(|\)|\bAND\b|\bOR\b|\bNOT\b)'
        parts = re.split(pattern, expr, flags=re.IGNORECASE)

        tokens = []

        for part in parts:
            part = part.strip()

            if not part:
                continue
            elif part == '(':
                tokens.append(('LP', None))
            elif part == ')':
                tokens.append(('RP', None))
            elif part.upper() in ('AND', 'OR', 'NOT'):
                tokens.append((part.upper(), None))
            else:
                tokens.append(('ATTR', part))

        return tokens


class _BooleanParser:
    """
    Recursive-descent parser.

    Grammar:
        OR  -> AND (OR AND)*
        AND -> NOT (AND NOT)*
        NOT -> NOT NOT | PRIMARY
        PRIMARY -> (OR) | ATTR
    """

    def __init__(self, tokens, user_attributes):
        self.tokens = tokens
        self.user = user_attributes
        self.pos = 0

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

    def parse(self):
        if not self.tokens:
            raise ValueError("Empty policy")

        result = self._parse_or()

        if self.pos != len(self.tokens):
            raise ValueError("Invalid policy expression")

        return result

    def _parse_or(self):
        value = self._parse_and()

        while self._peek()[0] == 'OR':
            self._advance()
            value = self._parse_and() or value

        return value

    def _parse_and(self):
        value = self._parse_not()

        while self._peek()[0] == 'AND':
            self._advance()
            value = self._parse_not() and value

        return value

    def _parse_not(self):
        if self._peek()[0] == 'NOT':
            self._advance()
            return not self._parse_not()

        return self._parse_primary()

    def _parse_primary(self):
        token_type, token_value = self._peek()

        if token_type == 'LP':
            self._advance()
            value = self._parse_or()

            if self._peek()[0] != 'RP':
                raise ValueError("Missing closing parenthesis")

            self._advance()
            return value

        if token_type == 'ATTR':
            self._advance()
            return token_value in self.user

        raise ValueError("Invalid policy expression")


policy_builder = CpAbePolicyBuilder()

