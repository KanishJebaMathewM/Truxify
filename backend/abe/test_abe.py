import unittest
from abe_cipher import CpAbeCipherEngine
from policy_builder import CpAbePolicyBuilder

class TestCPABE(unittest.TestCase):
    def setUp(self):
        self.cipher = CpAbeCipherEngine()
        self.builder = CpAbePolicyBuilder()

    def test_authorized_decryption(self):
        policy = self.builder.build_trip_document_policy(trip_id="TRIP_1001", allowed_role="Driver")
        doc_data = b"CONFIDENTIAL_BILL_OF_LADING"

        enc = self.cipher.encrypt_document(doc_data, policy)
        driver_attrs = {"Role: Driver", "TripID: TRIP_1001"}

        decrypted = self.cipher.decrypt_document(enc["ciphertext_b64"], policy, driver_attrs)
        self.assertEqual(decrypted, doc_data)

    def test_unauthorized_decryption_rejection(self):
        policy = self.builder.build_trip_document_policy(trip_id="TRIP_1001", allowed_role="Driver")
        doc_data = b"CONFIDENTIAL_BILL_OF_LADING"

        enc = self.cipher.encrypt_document(doc_data, policy)
        wrong_attrs = {"Role: Driver", "TripID: TRIP_9999"}  # Wrong trip ID

        with self.assertRaises(PermissionError):
            self.cipher.decrypt_document(enc["ciphertext_b64"], policy, wrong_attrs)


class TestPolicyEvaluator(unittest.TestCase):
    def setUp(self):
        self.builder = CpAbePolicyBuilder()

    def test_multi_or_second_branch_grants(self):
        policy = "(Role: Driver AND TripID: TRIP_1001) OR Role: Admin"
        self.assertTrue(self.builder.evaluate_user_attributes({"Role: Admin"}, policy))

    def test_multi_or_first_branch_grants(self):
        policy = "(Role: Driver AND TripID: TRIP_1001) OR Role: Admin"
        self.assertTrue(
            self.builder.evaluate_user_attributes({"Role: Driver", "TripID: TRIP_1001"}, policy)
        )

    def test_multi_or_denies_when_no_branch_satisfied(self):
        policy = "(Role: Driver AND TripID: TRIP_1001) OR Role: Admin"
        self.assertFalse(self.builder.evaluate_user_attributes({"Role: Driver"}, policy))
        self.assertFalse(self.builder.evaluate_user_attributes({"Role: Manager", "TripID: TRIP_9999"}, policy))

    def test_nested_parentheses_and_precedence(self):
        policy = "(Role: Driver OR Role: Manager) AND (TripID: TRIP_1001 OR TripID: TRIP_2001)"
        self.assertTrue(
            self.builder.evaluate_user_attributes({"Role: Manager", "TripID: TRIP_2001"}, policy)
        )
        self.assertFalse(
            self.builder.evaluate_user_attributes({"Role: Manager", "TripID: TRIP_9999"}, policy)
        )

    def test_fails_closed_on_malformed_policy(self):
        self.assertFalse(self.builder.evaluate_user_attributes({"Role: Admin"}, "(Role: Driver AND TripID: TRIP_1001"))
        self.assertFalse(self.builder.evaluate_user_attributes({"Role: Admin"}, "Role: Driver AND AND TripID: X"))
        self.assertFalse(self.builder.evaluate_user_attributes({"Role: Admin"}, "()"))
        self.assertFalse(self.builder.evaluate_user_attributes({"Role: Admin"}, ""))

    def test_fails_closed_on_non_string_policy(self):
        self.assertFalse(self.builder.evaluate_user_attributes({"Role: Admin"}, None))


if __name__ == '__main__':
    unittest.main()
