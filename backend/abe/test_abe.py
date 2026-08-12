import unittest
from abe_cipher import CpAbeCipherEngine
from policy_builder import CpAbePolicyBuilder
from abe_core import DecentralizedABE, AccessPolicy


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


class TestMultiAuthority(unittest.TestCase):
    def setUp(self):
        self.dabe = DecentralizedABE()
        self.dabe.add_authority('auth-1', 'public-key-1')
        self.policy = "(Role: Driver AND TripID: TRIP_1001) OR Role: Admin"

    def _issued_attrs(self, *attrs):
        return {"auth-1": {"attributes": list(attrs)}}

    def test_grants_user_with_all_required_attributes(self):
        user = self._issued_attrs("Role: Driver", "TripID: TRIP_1001")
        self.assertTrue(self.dabe._check_multi_authority_attributes(user, self.policy))

    def test_grants_admin_via_second_branch(self):
        user = self._issued_attrs("Role: Admin")
        self.assertTrue(self.dabe._check_multi_authority_attributes(user, self.policy))

    def test_denies_user_missing_a_required_attribute(self):
        user = self._issued_attrs("Role: Driver", "TripID: TRIP_9999")
        self.assertFalse(self.dabe._check_multi_authority_attributes(user, self.policy))

    def test_fails_closed_on_empty_attributes(self):
        self.assertFalse(self.dabe._check_multi_authority_attributes({}, self.policy))
        self.assertFalse(self.dabe._check_multi_authority_attributes(None, self.policy))

    def test_fails_closed_on_malformed_policy(self):
        user = self._issued_attrs("Role: Driver", "TripID: TRIP_1001")
        self.assertFalse(self.dabe._check_multi_authority_attributes(user, None))
        self.assertFalse(self.dabe._check_multi_authority_attributes(user, ""))

    def test_decrypt_fails_closed_for_unauthorized_user(self):
        enc = self.dabe.encrypt(
            "secret",
            AccessPolicy(expression=self.policy, attributes=["Role: Driver", "TripID: TRIP_1001", "Role: Admin"]),
            authorities=["auth-1"],
        )
        self.assertTrue(enc["success"])

        unauthorized = self._issued_attrs("Role: Driver")
        result = self.dabe.decrypt(enc, unauthorized)
        self.assertFalse(result["success"])
        self.assertEqual(result["error"], "Insufficient attributes")

        authorized = self._issued_attrs("Role: Driver", "TripID: TRIP_1001")
        result = self.dabe.decrypt(enc, authorized)
        self.assertTrue(result["success"])


if __name__ == '__main__':
    unittest.main()
