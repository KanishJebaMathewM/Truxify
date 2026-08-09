"""
Unit tests for backend/ml/app/models/trust_scorer.py

Run with: python3 -m pytest tests/test_trust_scorer.py -v --no-header
"""
import numpy as np
from app.models.trust_scorer import (
    generate_synthetic_trust_data,
    _compute_trust_score,
    RISK_LABELS,
    FEATURE_NAMES,
)


class TestGenerateSyntheticTrustData:
    """Tests for synthetic data generation."""

    def test_returns_correct_shape(self):
        """X and y arrays should have matching first dimension."""
        X, y = generate_synthetic_trust_data(n_samples=100)
        assert X.shape[0] == 100
        assert len(y) == 100

    def test_y_contains_only_valid_labels(self):
        """Risk labels should only contain values in RISK_LABELS."""
        _, y = generate_synthetic_trust_data(n_samples=200)
        valid_labels = set(RISK_LABELS.keys())
        assert set(y).issubset(valid_labels)

    def test_feature_count_matches_FEATURE_NAMES(self):
        """X should have as many columns as FEATURE_NAMES."""
        X, _ = generate_synthetic_trust_data(n_samples=50)
        assert X.shape[1] == len(FEATURE_NAMES)


class TestComputeTrustScore:
    """Tests for the deterministic trust score formula."""

    def test_perfect_driver_max_score(self):
        """Perfect driver should score close to 100."""
        score = _compute_trust_score(
            cancellation_rate=0.0,
            on_time_pct=100.0,
            avg_rating=5.0,
            dispute_count=0,
            is_verified=1,
        )
        # Expected: 100*0.3 + (5-0)*0.2*20 + 5*0.25*20 + 5 - 0 = 30+20+25+5 = 80
        # Rescaled: 80 * (100/80) = 100
        assert score == 100.0

    def test_worst_driver_min_score(self):
        """Worst-case driver should score close to 0."""
        score = _compute_trust_score(
            cancellation_rate=1.0,  # Max cancellation
            on_time_pct=0.0,       # Never on time
            avg_rating=1.0,        # Worst rating
            dispute_count=20,       # Max disputes
            is_verified=0,         # Not verified
        )
        # Worst: 0*0.3 + (5-5)*0.2*20 + 1*0.25*20 + 0 - 30 = 5*5 = 25
        # Rescaled: 25 * (100/80) = 31.25
        assert 0 <= score <= 100

    def test_score_is_bounded(self):
        """Trust score must be in [0, 100] regardless of inputs."""
        # Extreme bad case
        score_bad = _compute_trust_score(1.0, 0.0, 1.0, 100, 0)
        assert 0 <= score_bad <= 100

        # Perfect case
        score_good = _compute_trust_score(0.0, 100.0, 5.0, 0, 1)
        assert 0 <= score_good <= 100

    def test_verified_driver_scores_higher(self):
        """Verified driver should score higher than unverified with same stats."""
        verified = _compute_trust_score(0.1, 80.0, 4.0, 3, is_verified=1)
        unverified = _compute_trust_score(0.1, 80.0, 4.0, 3, is_verified=0)
        assert verified > unverified

    def test_high_disputes_reduces_score(self):
        """High dispute count should lower the trust score."""
        low_disputes = _compute_trust_score(0.1, 80.0, 4.0, 2, 1)
        high_disputes = _compute_trust_score(0.1, 80.0, 4.0, 10, 1)
        assert low_disputes > high_disputes
