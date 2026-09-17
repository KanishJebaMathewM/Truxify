import unittest
import time
from vdf_allocator import WesolowskiVDF, VdfLoadAllocator

class TestVDFAllocator(unittest.TestCase):
    def setUp(self):
        self.vdf = WesolowskiVDF(modulus=2047, iterations=500)
        self.allocator = VdfLoadAllocator()

    def test_vdf_evaluation_and_verification(self):
        seed = "LOAD_101:DRIVER_42:1775462400"
        y, proof = self.vdf.eval(seed)
        self.assertTrue(self.vdf.verify(seed, y, proof))

    def test_vdf_tamper_rejection(self):
        seed = "LOAD_101:DRIVER_42:1775462400"
        y, proof = self.vdf.eval(seed)
        self.assertFalse(self.vdf.verify(seed, y + 1, proof))

    def test_allocator_evaluation(self):
        result = self.allocator.evaluate_bid_fairness("LOAD_500", "DRV_88", time.time())
        self.assertTrue(result["is_fairly_allocated"])


class TestVDFCore(unittest.TestCase):
    def test_core_tamper_rejection(self):
        from vdf_core import VDFService

        service = VDFService(iterations=200)
        payload = b"issue-13072-test-seed"

        result = service.evaluate(payload)
        self.assertTrue(result["success"])

        output = bytes.fromhex(result["output"])
        proof = result["proof"].encode()

        # Genuine proof/proof verifies
        self.assertTrue(service.verify(payload, output, proof)["valid"])

        # A tampered output (not x^(2^T) mod N) must be rejected
        tampered = (int.from_bytes(output, "big") ^ 1).to_bytes(32, "big")
        self.assertFalse(service.verify(payload, tampered, proof)["valid"])


if __name__ == '__main__':
    unittest.main()
