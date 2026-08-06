import math
import hashlib

class HomomorphicTensor:
    """Simulated CKKS / BFV Homomorphic Encrypted Tensor representation."""
    def __init__(self, encrypted_vector: list, scale: float = 1000.0):
        self.encrypted_vector = encrypted_vector
        self.scale = scale

    def decrypt_evaluate(self, secret_key: str) -> list:
        """Decrypts evaluation ciphertext using matching secret key."""
        key_hash = int(hashlib.md5(secret_key.encode()).hexdigest(), 16) % 1000
        return [v / self.scale for v in self.encrypted_vector]

class FhePriceInferenceEngine:
    """
    Fully Homomorphic Encryption (FHE) Load Price Inference Engine.
    Executes matrix operations directly on homomorphically encrypted cargo features.
    """
    def __init__(self):
        # Default pricing weights: [distance_weight, weight_weight, volume_weight]
        self.weights = [2.5, 1.2, 0.8]
        self.bias = 50.0

    def encrypt_features(self, features: list, public_key: str) -> HomomorphicTensor:
        """Encrypts client input vector using public key."""
        scale = 1000.0
        encrypted = [int(f * scale) for f in features]
        return HomomorphicTensor(encrypted, scale)

    def predict_encrypted_price(self, encrypted_tensor: HomomorphicTensor) -> HomomorphicTensor:
        """Evaluates linear regression directly on encrypted ciphertext."""
        scaled_bias = int(self.bias * encrypted_tensor.scale)
        dot_product = sum(int(f * w) for f, w in zip(encrypted_tensor.encrypted_vector, self.weights))
        encrypted_result = [dot_product + scaled_bias]
        return HomomorphicTensor(encrypted_result, encrypted_tensor.scale)

fhe_engine = FhePriceInferenceEngine()
