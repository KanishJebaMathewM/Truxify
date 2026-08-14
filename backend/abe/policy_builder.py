class CpAbePolicyBuilder:
    """
    Builds Ciphertext-Policy Attribute-Based Encryption (CP-ABE) boolean policy strings from logistics attributes.
    """
    def build_trip_document_policy(self, trip_id: str, allowed_role: str = "Driver") -> str:
        return f"(Role: {allowed_role} AND TripID: {trip_id}) OR Role: Admin"

    def evaluate_user_attributes(self, user_attributes: set, policy_str: str) -> bool:
        """Evaluates whether the user attribute set satisfies the CP-ABE boolean expression.

        Honors the full boolean tree (OR / AND / parentheses / NOT) and compares
        attribute names exactly as issued, so a user satisfies the policy iff
        their attributes match the logical expression.
        """
        tokens = self._tokenize(policy_str)
        return _BooleanParser(tokens, user_attributes).parse()

    def _tokenize(self, expr: str):
        """Tokenize a policy string into AND/OR/NOT/paren and attribute tokens.

        Consecutive words that are not operators are joined into a single
        attribute token, so multi-word values (e.g. ``Role: Driver``) are matched
        exactly. A parenthesis is treated as a grouping operator only when it is
        a leading ``(`` or a trailing ``)`` that has no internal parenthesis in
        the same word; otherwise it is part of the attribute value (e.g.
        ``dept:(eng)`` is kept intact and matched exactly).
        """
        tokens = []
        buffer = []

        def flush():
            if buffer:
                tokens.append(('ATTR', ' '.join(buffer)))
                buffer.clear()

        for word in expr.split():
            # A leading '(' is a grouping operator.
            if word.startswith('('):
                flush()
                tokens.append(('LP', None))
                word = word[1:]
            # A trailing ')' is a grouping operator only if the word contains no
            # internal '(' (otherwise it closes an attribute-internal paren).
            if word.endswith(')') and '(' not in word:
                word = word[:-1]
                if word:
                    buffer.append(word)
                flush()
                tokens.append(('RP', None))
                continue
            if not word:
                continue
            if word.upper() in ('AND', 'OR', 'NOT'):
                flush()
                tokens.append((word.upper(), None))
                continue
            buffer.append(word)
        flush()
        return tokens


class _BooleanParser:
    """Recursive-descent evaluator for the policy token stream.

    Grammar::

        or_expr  := and_expr (OR and_expr)*
        and_expr := not_expr (AND not_expr)*
        not_expr := NOT not_expr | primary
        primary  := LP or_expr RP | ATTR
    """

    def __init__(self, tokens, user_attributes):
        self.tokens = tokens
        self.user = user_attributes
        self.pos = 0

    def parse(self):
        return self._parse_or()

    def _peek(self):
        return self.tokens[self.pos] if self.pos < len(self.tokens) else (None, None)

    def _advance(self):
        token = self.tokens[self.pos]
        self.pos += 1
        return token

    def _parse_or(self):
        value = self._parse_and()
        while self._peek()[0] == 'OR':
            self._advance()
            right = self._parse_and()
            value = value or right
        return value

    def _parse_and(self):
        value = self._parse_not()
        while self._peek()[0] == 'AND':
            self._advance()
            right = self._parse_not()
            value = value and right
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
            inner = self._parse_or()
            if self._peek()[0] == 'RP':
                self._advance()
            return inner
        if token_type == 'ATTR':
            self._advance()
            return token_value in self.user
        return False


policy_builder = CpAbePolicyBuilder()
