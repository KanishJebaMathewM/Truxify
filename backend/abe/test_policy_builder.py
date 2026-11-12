
import unittest

from policy_builder import CpAbePolicyBuilder


class TestPolicyBuilderEvaluation(unittest.TestCase):

    def setUp(self):
        self.builder = CpAbePolicyBuilder()

    def test_and_only(self):
        self.assertTrue(
            self.builder.evaluate_user_attributes({'a', 'b'}, 'a AND b')
        )
        self.assertFalse(
            self.builder.evaluate_user_attributes({'a'}, 'a AND b')
        )

    def test_or_only(self):
        self.assertTrue(
            self.builder.evaluate_user_attributes({'a'}, 'a OR b')
        )
        self.assertFalse(
            self.builder.evaluate_user_attributes(set(), 'a OR b')
        )

    def test_mixed_or_branch_not_truncated(self):
        policy = 'role:driver AND cleared:true OR admin:true'

        self.assertTrue(
            self.builder.evaluate_user_attributes({'admin:true'}, policy)
        )
        self.assertFalse(
            self.builder.evaluate_user_attributes({'role:driver'}, policy)
        )

    def test_parenthesized_group(self):
        policy = '(a AND b) OR (c AND d)'

        self.assertTrue(
            self.builder.evaluate_user_attributes({'c', 'd'}, policy)
        )
        self.assertFalse(
            self.builder.evaluate_user_attributes({'a'}, policy)
        )

    def test_exact_attribute_matching_preserves_parens(self):
        policy = 'dept:(eng)'

        self.assertTrue(
            self.builder.evaluate_user_attributes({'dept:(eng)'}, policy)
        )
        self.assertFalse(
            self.builder.evaluate_user_attributes({'dept:eng'}, policy)
        )

    def test_not_operator(self):
        policy = 'NOT banned:true'

        self.assertTrue(
            self.builder.evaluate_user_attributes(set(), policy)
        )
        self.assertFalse(
            self.builder.evaluate_user_attributes({'banned:true'}, policy)
        )

    def test_build_trip_document_policy(self):
        policy = self.builder.build_trip_document_policy('T1')

        self.assertTrue(
            self.builder.evaluate_user_attributes(
                {'Role: Driver', 'TripID: T1'}, policy
            )
        )
        self.assertTrue(
            self.builder.evaluate_user_attributes({'Role: Admin'}, policy)
        )
        self.assertFalse(
            self.builder.evaluate_user_attributes({'Role: Driver'}, policy)
        )


if __name__ == '__main__':
    unittest.main()

