import unittest
from fhe_inference import FhePriceInferenceEngine

class TestFheInference(unittest.TestCase):
    def setUp(self):
        self.engine = FhePriceInferenceEngine()

    def test_encrypted_prediction(self):
        features = [100.0, 10.0, 5.0] # 100km, 10 tons, 5 m^3
        pub_key, sec_key = FhePriceInferenceEngine.generate_key_pair()

        encrypted_input = self.engine.encrypt_features(features, pub_key)
        encrypted_price = self.engine.predict_encrypted_price(encrypted_input)

        decrypted_price = encrypted_price.decrypt_evaluate(sec_key)[0]
        expected_price = (100.0 * 2.5) + (10.0 * 1.2) + (5.0 * 0.8) + 50.0

        self.assertAlmostEqual(decrypted_price, expected_price, places=2)

    def test_wrong_key_fails(self):
        features = [100.0, 10.0, 5.0]
        pub_key, _ = FhePriceInferenceEngine.generate_key_pair()
        wrong_key = "THIS_IS_NOT_THE_SECRET_KEY"

        encrypted_input = self.engine.encrypt_features(features, pub_key)
        encrypted_price = self.engine.predict_encrypted_price(encrypted_input)

        with self.assertRaises(ValueError):
            encrypted_price.decrypt_evaluate(wrong_key)

if __name__ == '__main__':
    unittest.main()
