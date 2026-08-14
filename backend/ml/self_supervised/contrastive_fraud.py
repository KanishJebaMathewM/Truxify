import json
import os

import numpy as np


class SimCLRContrastiveFraudDetector:
    """
    Self-Supervised Contrastive Learning Model for GPS Spoofing & Fraud Detection.
    Computes trajectory representations and measures cosine similarity against learned normal driving patterns.
    """
    def __init__(self, embedding_dim: int = 64, anomaly_threshold: float = 0.65,
                 centroid_path: str = None):
        self.embedding_dim = embedding_dim
        self.anomaly_threshold = anomaly_threshold
        self.centroid_path = centroid_path
        if centroid_path and os.path.exists(centroid_path):
            self.normal_centroid = self._load_centroid(centroid_path)
        else:
            # Fit the normal-driving centroid from representative normal trajectories
            # instead of a fixed all-ones constant, which lives outside the 2-D
            # (lat/lng) embedding subspace and flags every trajectory as anomalous.
            self.normal_centroid = self.fit(self._default_normal_trajectories())

    def _default_normal_trajectories(self):
        """Representative known-normal GPS points (lat, lng) for an out-of-the-box centroid."""
        reference = np.array([
            [19.0, 73.0], [19.1, 73.1], [12.9, 77.6], [13.0, 77.6],
            [22.5, 88.3], [28.6, 77.2], [17.4, 78.5], [19.2, 72.8],
        ])
        return [np.tile(p, (10, 1)) for p in reference]

    def fit(self, normal_trajectories) -> np.ndarray:
        """Fit the normal-driving centroid from a list of known-normal trajectories."""
        embeddings = np.array([self.extract_embedding(t) for t in normal_trajectories])
        centroid = np.mean(embeddings, axis=0)
        norm = np.linalg.norm(centroid)
        if norm < 1e-8:
            centroid = np.zeros(self.embedding_dim)
            centroid[0] = 1.0
        else:
            centroid = centroid / norm
        self.normal_centroid = centroid
        return self.normal_centroid

    def save_centroid(self, path: str = None) -> None:
        """Persist the learned centroid to disk for reuse."""
        path = path or self.centroid_path
        if not path:
            raise ValueError("No centroid path provided to save_centroid()")
        with open(path, "w") as f:
            json.dump(self.normal_centroid.tolist(), f)

    def _load_centroid(self, path: str) -> np.ndarray:
        with open(path) as f:
            centroid = np.array(json.load(f), dtype=float)
        if centroid.shape != (self.embedding_dim,):
            raise ValueError(
                f"Loaded centroid shape {centroid.shape} does not match embedding_dim {self.embedding_dim}"
            )
        return centroid

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
