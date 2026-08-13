import unittest
from fraud_gan import WganGpAnomalyGenerator

class TestFraudGan(unittest.TestCase):
    def setUp(self):
        self.generator = WganGpAnomalyGenerator()

    def test_adversarial_generation(self):
        res = self.generator.generate_adversarial_telemetry(batch_size=5)
        
        self.assertEqual(res["batch_size"], 5)
        self.assertEqual(len(res["anomalous_records"]), 5)
        self.assertIn("latitude_jump_cm", res["anomalous_records"][0])
        self.assertEqual(res["stress_test_mode"], "ACTIVE")

if __name__ == '__main__':
    unittest.main()
