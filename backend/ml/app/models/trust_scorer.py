import logging
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, classification_report
from sklearn.preprocessing import StandardScaler

from .base import save_model, load_model, model_exists

logger = logging.getLogger(__name__)

MODEL_NAME = "trust_scorer"

# NOTE: This module currently trains on synthetic (randomly generated) data
# as a placeholder. Replace generate_synthetic_trust_data() with a real
# data pipeline that loads historical driver/customer behavioural data from
# PostgreSQL or MongoDB to make predictions meaningful.


def generate_synthetic_trust_data(n_samples: int = 1500) -> tuple:
    """Generate synthetic driver/customer behavioural profiles.

    Creates correlated behavioural data with realistic distributions:
    cancellation rates follow a beta distribution (skewed low),
    on-time percentages are skewed high, dispute counts follow Poisson.

    Args:
        n_samples: Number of profiles to generate.

    Returns:
        Tuple of (X feature array, y risk label array, trust_scores array).
    """
    np.random.seed(42)

    # Cancellation rate: beta distribution skewed toward low values
    cancellation_rate = np.random.beta(2, 8, n_samples) * 0.5  # 0.0 - 0.5

    # On-time percentage: skewed high (50-100%)
    on_time_pct = 50 + np.random.beta(5, 2, n_samples) * 50

    # Average rating: 1.0 - 5.0
    avg_rating = 1.0 + np.random.beta(5, 2, n_samples) * 4.0

    # Dispute count: Poisson with lambda=2, capped at 20
    dispute_count = np.minimum(np.random.poisson(2, n_samples), 20)

    # Verification: 80% verified
    is_verified = (np.random.random(n_samples) < 0.8).astype(int)

    # Assign risk labels
    risk_labels = np.full(n_samples, 1, dtype=int)  # Default: Medium (1)

    high_mask = (
        (cancellation_rate > 0.3)
        | (on_time_pct < 70)
        | (dispute_count > 10)
    )
    low_mask = (
        (cancellation_rate < 0.1)
        & (on_time_pct > 90)
        & (dispute_count < 3)
    )

    risk_labels[high_mask] = 2   # High
    risk_labels[low_mask] = 0    # Low

    X = np.column_stack([
        cancellation_rate,
        on_time_pct,
        avg_rating,
        dispute_count,
        is_verified,
    ])

    return X, risk_labels


FEATURE_NAMES = [
    "cancellation_rate",
    "on_time_pct",
    "avg_rating",
    "dispute_count",
    "is_verified",
]

RISK_LABELS = {0: "Low", 1: "Medium", 2: "High"}


def _compute_trust_score(
    cancellation_rate: float,
    on_time_pct: float,
    avg_rating: float,
    dispute_count: int,
    is_verified: int,
) -> float:
    """Compute a deterministic trust score from behavioural inputs.

    Weighted combination:
      - on_time_pct contribution:   on_time_pct * 0.3
      - cancellation contribution:  (5 - cancellation_rate * 5) * 0.2 * 20
      - rating contribution:        avg_rating * 0.25 * 20
      - verified bonus:             +5 if verified
      - dispute penalty:            -dispute_count * 1.5

    Result is clipped to [0, 100].
    """
    score = (
        on_time_pct * 0.3
        + (5 - cancellation_rate * 5) * 0.2 * 20
        + avg_rating * 0.25 * 20
        + (5.0 if is_verified else 0.0)
        - dispute_count * 1.5
    )
    # The raw weights above sum to a maximum of 80 for a flawless driver.
    # Rescale so a perfect driver reaches the documented 100 ceiling.
    score = score * (100.0 / 80.0)
    return float(np.clip(score, 0.0, 100.0))


class TrustScorer:
    """Driver/customer trust scoring and risk classification.

    Uses a RandomForestClassifier to predict risk category (Low/Medium/High)
    and a deterministic weighted formula for the trust score.
    """

    def __init__(self):
        self.model = None
        self.scaler = None

    def train(self) -> dict:
        """Train the risk classification model on synthetic behavioural data.

        Returns:
            Dictionary of training metrics (accuracy, classification report).
        """
        logger.info("Training trust scorer model...")
        X, y = generate_synthetic_trust_data()

        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42
        )

        self.scaler = StandardScaler()
        X_train_scaled = self.scaler.fit_transform(X_train)
        X_test_scaled = self.scaler.transform(X_test)

        self.model = RandomForestClassifier(
            n_estimators=150,
            max_depth=8,
            random_state=42,
        )
        self.model.fit(X_train_scaled, y_train)

        y_pred = self.model.predict(X_test_scaled)
        accuracy = accuracy_score(y_test, y_pred)
        report = classification_report(y_test, y_pred, output_dict=True)

        metrics = {
            "accuracy": float(accuracy),
            "classification_report": report,
            "n_samples": len(X),
            "feature_names": FEATURE_NAMES,
        }

        save_model((self.model, self.scaler), MODEL_NAME, metrics)
        logger.info("Trust scorer model trained. Accuracy: %.3f", accuracy)
        return metrics

    def load(self) -> None:
        """Load a persisted model, training first if none exists."""
        if not model_exists(MODEL_NAME):
            self.train()
            return

        loaded = load_model(MODEL_NAME)
        if loaded is None:
            logger.warning("Failed to load trust scorer model; retraining")
            self.train()
            return

        self.model, self.scaler = loaded
        logger.info("Trust scorer model loaded from persistence")

    def predict(
        self,
        cancellation_rate: float,
        on_time_pct: float,
        avg_rating: float,
        dispute_count: int,
        is_verified: int,
    ) -> dict:
        """Score a driver or customer on trust and risk.

        Args:
            cancellation_rate: Fraction of bookings cancelled (0.0-1.0).
            on_time_pct: Percentage of on-time deliveries (0-100).
            avg_rating: Mean user rating (1.0-5.0).
            dispute_count: Number of disputes filed.
            is_verified: 1 if identity-verified, 0 otherwise.

        Returns:
            Dict with trust_score (0-100) and risk_category ('Low'/'Medium'/'High').
        """
        if self.model is None or self.scaler is None:
            self.load()

        # Deterministic trust score
        trust_score = _compute_trust_score(
            cancellation_rate, on_time_pct, avg_rating, dispute_count, is_verified
        )

        # ML-based risk category
        features = np.array([[
            cancellation_rate,
            on_time_pct,
            avg_rating,
            dispute_count,
            is_verified,
        ]])
        features_scaled = self.scaler.transform(features)
        risk_idx = int(self.model.predict(features_scaled)[0])
        risk_category = RISK_LABELS.get(risk_idx, "Medium")

        return {
            "trust_score": round(trust_score, 2),
            "risk_category": risk_category,
        }


# Module-level singleton instance
trust_scorer = TrustScorer()
