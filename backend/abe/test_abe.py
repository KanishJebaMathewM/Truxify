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

if __name__ == '__main__':
    unittest.main()
