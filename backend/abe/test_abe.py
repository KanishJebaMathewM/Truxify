
import base64
import os
import unittest

os.environ.setdefault("ABE_MASTER_SECRET", "test-master-secret-for-cpabe")

from cryptography.exceptions import InvalidTag
from abe_cipher import CpAbeCipherEngine
from policy_builder import CpAbePolicyBuilder


class TestCPABE(unittest.TestCase):

    def setUp(self):
        self.cipher = CpAbeCipherEngine()
        self.builder = CpAbePolicyBuilder()

    def test_authorized_decryption(self):
        policy = self.builder.build_trip_document_policy("TRIP_1001", "Driver")
        data = b"CONFIDENTIAL_BILL_OF_LADING"

        enc = self.cipher.encrypt_document(data, policy)
        attrs = {"Role: Driver", "TripID: TRIP_1001"}

        result = self.cipher.decrypt_document(
            enc["ciphertext_b64"], policy, attrs
        )
        self.assertEqual(result, data)

    def test_unauthorized_decryption_rejection(self):
        policy = self.builder.build_trip_document_policy("TRIP_1001", "Driver")
        data = b"CONFIDENTIAL_BILL_OF_LADING"

        enc = self.cipher.encrypt_document(data, policy)
        attrs = {"Role: Driver", "TripID: TRIP_9999"}

        with self.assertRaises(PermissionError):
            self.cipher.decrypt_document(enc["ciphertext_b64"], policy, attrs)

    def test_same_plaintext_gets_distinct_ciphertexts(self):
        policy = self.builder.build_trip_document_policy("TRIP_1001", "Driver")
        data = b"CONFIDENTIAL_BILL_OF_LADING"

        first = self.cipher.encrypt_document(data, policy)
        second = self.cipher.encrypt_document(data, policy)

        self.assertNotEqual(
            first["ciphertext_b64"], second["ciphertext_b64"]
        )

        attrs = {"Role: Driver", "TripID: TRIP_1001"}
        self.assertEqual(
            self.cipher.decrypt_document(first["ciphertext_b64"], policy, attrs),
            data
        )
        self.assertEqual(
            self.cipher.decrypt_document(second["ciphertext_b64"], policy, attrs),
            data
        )

    def test_ciphertext_tampering_is_rejected(self):
        policy = self.builder.build_trip_document_policy("TRIP_1001", "Driver")
        data = b"CONFIDENTIAL_BILL_OF_LADING"
        attrs = {"Role: Driver", "TripID: TRIP_1001"}

        encoded = self.cipher.encrypt_document(data, policy)["ciphertext_b64"]
        payload = bytearray(base64.b64decode(encoded))
        payload[-1] ^= 1

        tampered = base64.b64encode(payload).decode("ascii")

        with self.assertRaises(InvalidTag):
            self.cipher.decrypt_document(tampered, policy, attrs)

    def test_policy_is_authenticated_as_associated_data(self):
        policy = self.builder.build_trip_document_policy("TRIP_1001", "Driver")
        data = b"CONFIDENTIAL_BILL_OF_LADING"
        attrs = {"Role: Driver", "TripID: TRIP_1001", "Role: Dispatcher"}

        enc = self.cipher.encrypt_document(data, policy)
        altered = self.builder.build_trip_document_policy("TRIP_1002", "Driver")

        with self.assertRaises((InvalidTag, PermissionError)):
            self.cipher.decrypt_document(enc["ciphertext_b64"], altered, attrs)


if __name__ == "__main__":
    unittest.main()

