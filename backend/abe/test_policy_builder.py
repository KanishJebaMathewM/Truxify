
import unittest

from policy_builder import CpAbePolicyBuilder


class TestPolicyBuilderEvaluation(unittest.TestCase):
    """Test boolean policy parsing and attribute evaluation."""

    def setUp(self):
        self.builder = CpAbePolicyBuilder()

    # --------------------------------------------------------------
    # Basic Boolean Operations
    # --------------------------------------------------------------

    def test_and_only(self):
        """Verify AND requires all attributes."""

        self.assertTrue(
            self.builder.evaluate_user_attributes(
                {"a", "b"}, "a AND b"
            )
        )

        self.assertFalse(
            self.builder.evaluate_user_attributes(
                {"a"}, "a AND b"
            )
        )

    def test_or_only(self):
        """Verify OR requires at least one matching attribute."""

        self.assertTrue(
            self.builder.evaluate_user_attributes(
                {"a"}, "a OR b"
            )
        )

        self.assertFalse(
            self.builder.evaluate_user_attributes(
                set(), "a OR b"
            )
        )

    def test_not_operator(self):
        """Verify NOT correctly negates attribute matching."""

        policy = "NOT banned:true"

        self.assertTrue(
            self.builder.evaluate_user_attributes(
                set(), policy
            )
        )

        self.assertFalse(
            self.builder.evaluate_user_attributes(
                {"banned:true"}, policy
            )
        )

    def test_double_not_operator(self):
        """Verify nested NOT operators."""

        self.assertTrue(
            self.builder.evaluate_user_attributes(
                {"a"}, "NOT NOT a"
            )
        )

        self.assertFalse(
            self.builder.evaluate_user_attributes(
                set(), "NOT NOT a"
            )
        )

    # --------------------------------------------------------------
    # Operator Precedence
    # --------------------------------------------------------------

    def test_and_has_higher_precedence_than_or(self):
        """Verify AND is evaluated before OR."""

        policy = "a OR b AND c"

        self.assertTrue(
            self.builder.evaluate_user_attributes(
                {"a"}, policy
            )
        )

        self.assertTrue(
            self.builder.evaluate_user_attributes(
                {"b", "c"}, policy
            )
        )

        self.assertFalse(
            self.builder.evaluate_user_attributes(
                {"b"}, policy
            )
        )

    def test_not_has_higher_precedence_than_and(self):
        """Verify NOT is evaluated before AND."""

        policy = "NOT a AND b"

        self.assertTrue(
            self.builder.evaluate_user_attributes(
                {"b"}, policy
            )
        )

        self.assertFalse(
            self.builder.evaluate_user_attributes(
                {"a", "b"}, policy
            )
        )

    def test_mixed_or_branch_not_truncated(self):
        """Ensure every OR branch is evaluated completely."""

        policy = "role:driver AND cleared:true OR admin:true"

        self.assertTrue(
            self.builder.evaluate_user_attributes(
                {"admin:true"}, policy
            )
        )

        self.assertTrue(
            self.builder.evaluate_user_attributes(
                {"role:driver", "cleared:true"}, policy
            )
        )

        self.assertFalse(
            self.builder.evaluate_user_attributes(
                {"role:driver"}, policy
            )
        )

    def test_multiple_or_branches(self):
        """Verify policies containing multiple OR branches."""

        policy = "a AND b OR c AND d OR e"

        test_cases = [
            ({"e"}, True),
            ({"c", "d"}, True),
            ({"a", "b"}, True),
            ({"c"}, False),
            ({"a"}, False),
            (set(), False),
        ]

        for attributes, expected in test_cases:
            with self.subTest(attributes=attributes):
                self.assertEqual(
                    self.builder.evaluate_user_attributes(
                        attributes, policy
                    ),
                    expected,
                )

    # --------------------------------------------------------------
    # Parentheses and Nested Policies
    # --------------------------------------------------------------

    def test_parenthesized_group(self):
        """Verify grouped logical expressions."""

        policy = "(a AND b) OR (c AND d)"

        self.assertTrue(
            self.builder.evaluate_user_attributes(
                {"c", "d"}, policy
            )
        )

        self.assertTrue(
            self.builder.evaluate_user_attributes(
                {"a", "b"}, policy
            )
        )

        self.assertFalse(
            self.builder.evaluate_user_attributes(
                {"a"}, policy
            )
        )

    def test_nested_parentheses(self):
        """Verify deeply nested logical expressions."""

        policy = "((a AND b) OR c) AND d"

        self.assertTrue(
            self.builder.evaluate_user_attributes(
                {"c", "d"}, policy
            )
        )

        self.assertTrue(
            self.builder.evaluate_user_attributes(
                {"a", "b", "d"}, policy
            )
        )

        self.assertFalse(
            self.builder.evaluate_user_attributes(
                {"c"}, policy
            )
        )

    def test_exact_attribute_matching_preserves_parens(self):
        """
        Verify parentheses inside attribute values are preserved.

        Requires the tokenizer to distinguish attribute-value
        parentheses from boolean grouping parentheses.
        """

        policy = "dept:(eng)"

        self.assertTrue(
            self.builder.evaluate_user_attributes(
                {"dept:(eng)"}, policy
            )
        )

        self.assertFalse(
            self.builder.evaluate_user_attributes(
                {"dept:eng"}, policy
            )
        )

    # --------------------------------------------------------------
    # Trip Document Policies
    # --------------------------------------------------------------

    def test_build_trip_document_policy(self):
        """Verify generated trip document access policies."""

        policy = self.builder.build_trip_document_policy("T1")

        self.assertTrue(
            self.builder.evaluate_user_attributes(
                {"Role: Driver", "TripID: T1"}, policy
            )
        )

        self.assertTrue(
            self.builder.evaluate_user_attributes(
                {"Role: Admin"}, policy
            )
        )

        self.assertFalse(
            self.builder.evaluate_user_attributes(
                {"Role: Driver"}, policy
            )
        )

    def test_custom_trip_document_role(self):
        """Verify custom roles can be used in generated policies."""

        policy = self.builder.build_trip_document_policy(
            "T2", "Dispatcher"
        )

        self.assertTrue(
            self.builder.evaluate_user_attributes(
                {"Role: Dispatcher", "TripID: T2"}, policy
            )
        )

        self.assertFalse(
            self.builder.evaluate_user_attributes(
                {"Role: Driver", "TripID: T2"}, policy
            )
        )

    # --------------------------------------------------------------
    # Attribute Matching
    # --------------------------------------------------------------

    def test_case_sensitive_attributes(self):
        """Verify attribute matching is case-sensitive."""

        self.assertTrue(
            self.builder.evaluate_user_attributes(
                {"Role: Admin"}, "Role: Admin"
            )
        )

        self.assertFalse(
            self.builder.evaluate_user_attributes(
                {"role: admin"}, "Role: Admin"
            )
        )

    def test_empty_user_attributes(self):
        """Verify empty user attributes do not satisfy policies."""

        self.assertFalse(
            self.builder.evaluate_user_attributes(
                set(), "a AND b"
            )
        )

    # --------------------------------------------------------------
    # Invalid Input and Malformed Policies
    # --------------------------------------------------------------

    def test_empty_policy_rejected(self):
        """Verify empty policies are rejected."""

        with self.assertRaises(ValueError):
            self.builder.evaluate_user_attributes(
                {"a"}, ""
            )

        with self.assertRaises(ValueError):
            self.builder.evaluate_user_attributes(
                {"a"}, "   "
            )

    def test_invalid_attribute_container_rejected(self):
        """Verify user attributes must be provided as a set."""

        with self.assertRaises(TypeError):
            self.builder.evaluate_user_attributes(
                ["a", "b"], "a AND b"
            )

    def test_non_string_attributes_rejected(self):
        """Verify attribute sets contain only strings."""

        with self.assertRaises(TypeError):
            self.builder.evaluate_user_attributes(
                {"a", 123}, "a"
            )

    def test_invalid_policy_type_rejected(self):
        """Verify policy expressions must be strings."""

        with self.assertRaises(ValueError):
            self.builder.evaluate_user_attributes(
                {"a"}, None
            )

    def test_malformed_policies_rejected(self):
        """Verify incomplete and invalid expressions are rejected."""

        invalid_policies = [
            "a AND",
            "OR a",
            "a OR OR b",
            "a AND AND b",
            "(a AND b",
            "a AND b)",
            "()",
            "a b",
            "NOT",
        ]

        for policy in invalid_policies:
            with self.subTest(policy=policy):
                with self.assertRaises(ValueError):
                    self.builder.evaluate_user_attributes(
                        {"a", "b"}, policy
                    )

    def test_invalid_trip_document_policy_rejected(self):
        """Verify empty trip IDs and roles are rejected."""

        with self.assertRaises(ValueError):
            self.builder.build_trip_document_policy("")

        with self.assertRaises(ValueError):
            self.builder.build_trip_document_policy(
                "T1", ""
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
