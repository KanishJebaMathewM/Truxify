import unittest

from policy_builder import CpAbePolicyBuilder


class TestPolicyBuilderEvaluation(unittest.TestCase):
    def setUp(self):
        self.builder = CpAbePolicyBuilder()

    def test_and_only(self):
        self.assertTrue(self.builder.evaluate_user_attributes(
            {'a', 'b'}, 'a AND b'))
        self.assertFalse(self.builder.evaluate_user_attributes(
            {'a'}, 'a AND b'))

    def test_or_only(self):
        self.assertTrue(self.builder.evaluate_user_attributes(
            {'a'}, 'a OR b'))
        self.assertFalse(self.builder.evaluate_user_attributes(
            set(), 'a OR b'))

    def test_mixed_or_branch_not_truncated(self):
        # The second OR branch must be honored, not truncated at the first OR.
        self.assertTrue(self.builder.evaluate_user_attributes(
            {'admin:true'}, 'role:driver AND cleared:true OR admin:true'))
        self.assertFalse(self.builder.evaluate_user_attributes(
            {'role:driver'}, 'role:driver AND cleared:true OR admin:true'))

    def test_parenthesized_group(self):
        self.assertTrue(self.builder.evaluate_user_attributes(
            {'c', 'd'}, '(a AND b) OR (c AND d)'))
        self.assertFalse(self.builder.evaluate_user_attributes(
            {'a'}, '(a AND b) OR (c AND d)'))

    def test_exact_attribute_matching_preserves_parens(self):
        # Tokens must be matched exactly; parens inside a value are not stripped.
        self.assertTrue(self.builder.evaluate_user_attributes(
            {'dept:(eng)'}, 'dept:(eng)'))
        self.assertFalse(self.builder.evaluate_user_attributes(
            {'dept:eng'}, 'dept:(eng)'))

    def test_not_operator(self):
        self.assertTrue(self.builder.evaluate_user_attributes(
            set(), 'NOT banned:true'))
        self.assertFalse(self.builder.evaluate_user_attributes(
            {'banned:true'}, 'NOT banned:true'))

    def test_build_trip_document_policy(self):
        policy = self.builder.build_trip_document_policy('T1')
        self.assertTrue(self.builder.evaluate_user_attributes(
            {'Role: Driver', 'TripID: T1'}, policy))
        self.assertTrue(self.builder.evaluate_user_attributes(
            {'Role: Admin'}, policy))
        self.assertFalse(self.builder.evaluate_user_attributes(
            {'Role: Driver'}, policy))


if __name__ == '__main__':
    unittest.main()
