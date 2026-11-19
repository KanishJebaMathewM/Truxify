
import base64
import os
import unittest

from cryptography.exceptions import InvalidTag

# Set a deterministic test secret before importing the cipher engine.
# This prevents an externally configured secret from affecting tests.
os.environ["ABE_MASTER_SECRET"] = "test-master-secret-for-cpabe"

from abe_cipher import CpAbeCipherEngine
from policy_builder import CpAbePolicyBuilder


class TestCPABE(unittest.TestCase):
    """Test CP-ABE encryption, authorization, and integrity."""

    TEST_TRIP_ID = "TRIP_1001"
    TEST_ROLE = "Driver"
    TEST_DATA = b"CONFIDENTIAL_BILL_OF_LADING"

    def setUp(self):
        self.cipher = CpAbeCipherEngine()
        self.builder = CpAbePolicyBuilder()

        self.policy = self.builder.build_trip_document_policy(
            self.TEST_TRIP_ID,
            self.TEST_ROLE,
        )

        self.authorized_attributes = {
            "Role: Driver",
            "TripID: TRIP_1001",
        }

    def test_authorized_decryption(self):
        """Verify that authorized users can decrypt documents."""

        encrypted = self.cipher.encrypt_document(
            self.TEST_DATA,
            self.policy,
        )

        result = self.cipher.decrypt_document(
            encrypted["ciphertext_b64"],
            self.policy,
            self.authorized_attributes,
        )

        self.assertEqual(result, self.TEST_DATA)

    def test_admin_override_access(self):
        """Verify that Admin attributes satisfy the policy."""

        encrypted = self.cipher.encrypt_document(
            self.TEST_DATA,
            self.policy,
        )

        admin_attributes = {"Role: Admin"}

        result = self.cipher.decrypt_document(
            encrypted["ciphertext_b64"],
            self.policy,
            admin_attributes,
        )

        self.assertEqual(result, self.TEST_DATA)

    def test_unauthorized_decryption_rejection(self):
        """Verify that users with incorrect trip IDs are rejected."""

        encrypted = self.cipher.encrypt_document(
            self.TEST_DATA,
            self.policy,
        )

        unauthorized_attributes = {
            "Role: Driver",
            "TripID: TRIP_9999",
        }

        with self.assertRaises(PermissionError):
            self.cipher.decrypt_document(
                encrypted["ciphertext_b64"],
                self.policy,
                unauthorized_attributes,
            )

    def test_same_plaintext_gets_distinct_ciphertexts(self):
        """Verify that encryption uses fresh randomness."""

        first = self.cipher.encrypt_document(
            self.TEST_DATA,
            self.policy,
        )

        second = self.cipher.encrypt_document(
            self.TEST_DATA,
            self.policy,
        )

        self.assertNotEqual(
            first["ciphertext_b64"],
            second["ciphertext_b64"],
        )

        first_result = self.cipher.decrypt_document(
            first["ciphertext_b64"],
            self.policy,
            self.authorized_attributes,
        )

        second_result = self.cipher.decrypt_document(
            second["ciphertext_b64"],
            self.policy,
            self.authorized_attributes,
        )

        self.assertEqual(first_result, self.TEST_DATA)
        self.assertEqual(second_result, self.TEST_DATA)

    def test_ciphertext_tampering_is_rejected(self):
        """Verify that AES-GCM detects modified ciphertext."""

        encrypted = self.cipher.encrypt_document(
            self.TEST_DATA,
            self.policy,
        )

        encoded = encrypted["ciphertext_b64"]

        payload = bytearray(
            base64.b64decode(encoded, validate=True)
        )

        self.assertGreater(
            len(payload),
            0,
            "Encrypted payload must not be empty",
        )

        # Modify the final byte, which should corrupt the
        # authentication tag in the expected AES-GCM format.
        payload[-1] ^= 0x01

        tampered = base64.b64encode(payload).decode("ascii")

        with self.assertRaises(InvalidTag):
            self.cipher.decrypt_document(
                tampered,
                self.policy,
                self.authorized_attributes,
            )

    def test_policy_is_authenticated_as_associated_data(self):
        """Verify that changing the policy invalidates authentication."""

        encrypted = self.cipher.encrypt_document(
            self.TEST_DATA,
            self.policy,
        )

        altered_policy = self.builder.build_trip_document_policy(
            "TRIP_1002",
            self.TEST_ROLE,
        )

        # These attributes satisfy the altered policy.
        altered_attributes = {
            "Role: Driver",
            "TripID: TRIP_1002",
        }

        # Even authorized attributes for the altered policy
        # must not decrypt ciphertext authenticated under
        # the original policy.
        with self.assertRaises((InvalidTag, PermissionError)):
            self.cipher.decrypt_document(
                encrypted["ciphertext_b64"],
                altered_policy,
                altered_attributes,
            )

    def test_admin_access_with_wrong_role_is_rejected(self):
        """Verify that non-admin users cannot bypass trip restrictions."""

        encrypted = self.cipher.encrypt_document(
            self.TEST_DATA,
            self.policy,
        )

        attributes = {
            "Role: Dispatcher",
            "TripID: TRIP_9999",
        }

        with self.assertRaises(PermissionError):
            self.cipher.decrypt_document(
                encrypted["ciphertext_b64"],
                self.policy,
                attributes,
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
