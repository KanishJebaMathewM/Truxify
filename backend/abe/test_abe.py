import unittest
from abe_cipher import CpAbeCipherEngine
from policy_builder import CpAbePolicyBuilder

class TestCPABE(unittest.TestCase):
    def setUp(self):
        self.cipher = CpAbeCipherEngine()
        self.builder = CpAbePolicyBuilder()

    def test_encryption_fails_closed(self):
        policy = self.builder.build_trip_document_policy(trip_id="TRIP_1001", allowed_role="Driver")
        doc_data = b"CONFIDENTIAL_BILL_OF_LADING"

        with self.assertRaises(NotImplementedError):
            self.cipher.encrypt_document(doc_data, policy)

    def test_decryption_fails_closed(self):
        policy = self.builder.build_trip_document_policy(trip_id="TRIP_1001", allowed_role="Driver")
        driver_attrs = {"Role: Driver", "TripID: TRIP_1001"}

        with self.assertRaises(NotImplementedError):
            self.cipher.decrypt_document("dGVzdA==", policy, driver_attrs)

if __name__ == '__main__':
    unittest.main()
