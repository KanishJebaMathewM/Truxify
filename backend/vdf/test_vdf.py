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

if __name__ == '__main__':
    unittest.main()
