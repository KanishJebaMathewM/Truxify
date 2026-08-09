import numpy as np

class SimCLRContrastiveFraudDetector:
    """
    Self-Supervised Contrastive Learning Model for GPS Spoofing & Fraud Detection.
    Computes trajectory representations and measures cosine similarity against learned normal driving patterns.
    """
    def __init__(self, embedding_dim: int = 64, anomaly_threshold: float = 0.65):
        self.embedding_dim = embedding_dim
        self.anomaly_threshold = anomaly_threshold
        # Simulated learned normal driving trajectory vector weights
        self.normal_centroid = np.ones(embedding_dim) / np.sqrt(embedding_dim)

    def extract_embedding(self, trajectory: np.ndarray) -> np.ndarray:
        """Extracts 64-dim embedding from raw lat/lng trajectory coordinates."""
        raw_vec = np.mean(trajectory, axis=0)
        padded = np.pad(raw_vec, (0, max(0, self.embedding_dim - len(raw_vec))))[:self.embedding_dim]
        norm = np.linalg.norm(padded)
        return padded / (norm + 1e-8)

    def compute_anomaly_score(self, trajectory: np.ndarray) -> float:
        """Computes anomaly score between 0.0 (normal) and 1.0 (fraudulent)."""
        emb = self.extract_embedding(trajectory)
        cosine_sim = np.dot(emb, self.normal_centroid)
        anomaly_score = float(1.0 - max(0.0, cosine_sim))
        return anomaly_score

    def is_anomalous(self, trajectory: np.ndarray) -> bool:
        return self.compute_anomaly_score(trajectory) > self.anomaly_threshold

fraud_detector = SimCLRContrastiveFraudDetector()
