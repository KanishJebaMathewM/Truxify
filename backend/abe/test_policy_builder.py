import unittest

from policy_builder import CpAbePolicyBuilder


class TestPolicyBuilderEvaluation(unittest.TestCase):

    def setUp(self):
        self.builder = CpAbePolicyBuilder()

    def test_and_only(self):
        """Test AND operator."""
        self.assertTrue(
            self.builder.evaluate_user_attributes({'a', 'b'}, 'a AND b')
        )
        self.assertFalse(
            self.builder.evaluate_user_attributes({'a'}, 'a AND b')
        )

    def test_or_only(self):
        """Test OR operator."""
        self.assertTrue(
            self.builder.evaluate_user_attributes({'a'}, 'a OR b')
        )
        self.assertFalse(
            self.builder.evaluate_user_attributes(set(), 'a OR b')
        )

    def test_mixed_or_branch_not_truncated(self):
        """Ensure OR branches are evaluated completely."""
        policy = 'role:driver AND cleared:true OR admin:true'

        self.assertTrue(
            self.builder.evaluate_user_attributes({'admin:true'}, policy)
        )
        self.assertFalse(
            self.builder.evaluate_user_attributes({'role:driver'}, policy)
        )

    def test_parenthesized_group(self):
        """Test nested logical groups."""
        policy = '(a AND b) OR (c AND d)'

        self.assertTrue(
            self.builder.evaluate_user_attributes({'c', 'd'}, policy)
        )
        self.assertFalse(
            self.builder.evaluate_user_attributes({'a'}, policy)
        )

    def test_exact_attribute_matching_preserves_parens(self):
        """Ensure parentheses inside attributes are preserved."""
        policy = 'dept:(eng)'

        self.assertTrue(
            self.builder.evaluate_user_attributes({'dept:(eng)'}, policy)
        )
        self.assertFalse(
            self.builder.evaluate_user_attributes({'dept:eng'}, policy)
        )

    def test_not_operator(self):
        """Test NOT operator."""
        policy = 'NOT banned:true'

        self.assertTrue(
            self.builder.evaluate_user_attributes(set(), policy)
        )
        self.assertFalse(
            self.builder.evaluate_user_attributes({'banned:true'}, policy)
        )

    def test_build_trip_document_policy(self):
        """Test generated trip document access policy."""
        policy = self.builder.build_trip_document_policy('T1')

        self.assertTrue(
            self.builder.evaluate_user_attributes(
                {'Role: Driver', 'TripID: T1'}, policy
            )
        )

        self.assertTrue(
            self.builder.evaluate_user_attributes(
                {'Role: Admin'}, policy
            )
        )

        self.assertFalse(
            self.builder.evaluate_user_attributes(
                {'Role: Driver'}, policy
            )
        )

    def test_empty_user_attributes(self):
        """Test evaluation with empty user attributes."""
        self.assertFalse(
            self.builder.evaluate_user_attributes(set(), 'a AND b')
        )

    def test_multiple_or_branches(self):
        """Test policies containing multiple OR branches."""
        policy = 'a AND b OR c AND d OR e'

        self.assertTrue(
            self.builder.evaluate_user_attributes({'e'}, policy)
        )
        self.assertTrue(
            self.builder.evaluate_user_attributes({'c', 'd'}, policy)
        )
        self.assertFalse(
            self.builder.evaluate_user_attributes({'c'}, policy)
        )

    def test_case_sensitive_attributes(self):
        """Test exact attribute matching."""
        self.assertTrue(
            self.builder.evaluate_user_attributes({'Role: Admin'}, 'Role: Admin')
        )
        self.assertFalse(
            self.builder.evaluate_user_attributes({'role: admin'}, 'Role: Admin')
        )


if __name__ == '__main__':
    unittest.main(verbosity=2)
