import base64
import os
import unittest

os.environ.setdefault('ABE_MASTER_SECRET', 'test-master-secret-for-cpabe')

from cryptography.exceptions import InvalidTag

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
        wrong_attrs = {"Role: Driver", "TripID: TRIP_9999"}

        with self.assertRaises(PermissionError):
            self.cipher.decrypt_document(enc["ciphertext_b64"], policy, wrong_attrs)

    def test_same_plaintext_gets_distinct_ciphertexts(self):
        policy = self.builder.build_trip_document_policy(trip_id="TRIP_1001", allowed_role="Driver")
        doc_data = b"CONFIDENTIAL_BILL_OF_LADING"

        first = self.cipher.encrypt_document(doc_data, policy)
        second = self.cipher.encrypt_document(doc_data, policy)

        self.assertNotEqual(first["ciphertext_b64"], second["ciphertext_b64"])
        attrs = {"Role: Driver", "TripID: TRIP_1001"}
        self.assertEqual(self.cipher.decrypt_document(first["ciphertext_b64"], policy, attrs), doc_data)
        self.assertEqual(self.cipher.decrypt_document(second["ciphertext_b64"], policy, attrs), doc_data)

    def test_ciphertext_tampering_is_rejected(self):
        policy = self.builder.build_trip_document_policy(trip_id="TRIP_1001", allowed_role="Driver")
        doc_data = b"CONFIDENTIAL_BILL_OF_LADING"
        attrs = {"Role: Driver", "TripID: TRIP_1001"}

        encoded = self.cipher.encrypt_document(doc_data, policy)["ciphertext_b64"]
        payload = bytearray(base64.b64decode(encoded))
        payload[-1] ^= 0x01
        tampered = base64.b64encode(payload).decode('ascii')

        with self.assertRaises(InvalidTag):
            self.cipher.decrypt_document(tampered, policy, attrs)

    def test_policy_is_authenticated_as_associated_data(self):
        policy = self.builder.build_trip_document_policy(trip_id="TRIP_1001", allowed_role="Driver")
        doc_data = b"CONFIDENTIAL_BILL_OF_LADING"
        attrs = {"Role: Driver", "TripID: TRIP_1001", "Role: Dispatcher"}

        enc = self.cipher.encrypt_document(doc_data, policy)
        altered_policy = self.builder.build_trip_document_policy(trip_id="TRIP_1002", allowed_role="Driver")

        with self.assertRaises((InvalidTag, PermissionError)):
            self.cipher.decrypt_document(enc["ciphertext_b64"], altered_policy, attrs)


if __name__ == '__main__':
    unittest.main()
