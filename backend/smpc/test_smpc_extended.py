"""Extended SMPC suite — threshold edge cases, share privacy, service aggregation."""
import secrets

import pytest

from smpc_node import ShamirSmpcEngine
from smpc_service import SecretSharing


class TestShamirEngineThresholds:
    def test_minimal_threshold_2_of_2(self):
        eng = ShamirSmpcEngine()
        shares = eng.split_secret(424242, k=2, n=2)
        assert eng.reconstruct_secret(shares) == 424242

    def test_any_k_of_n_subset_recovers(self):
        eng = ShamirSmpcEngine()
        shares = eng.split_secret(777, k=3, n=7)
        # all C(7,3) = 35 subsets must recover
        import itertools
        for combo in itertools.combinations(shares, 3):
            assert eng.reconstruct_secret(list(combo)) == 777

    def test_large_secret_near_field_size(self):
        eng = ShamirSmpcEngine()
        big = eng.prime - 2
        shares = eng.split_secret(big, k=3, n=5)
        assert eng.reconstruct_secret(shares[:3]) == big

    def test_zero_secret(self):
        eng = ShamirSmpcEngine()
        shares = eng.split_secret(0, k=3, n=5)
        assert eng.reconstruct_secret(shares[:3]) == 0

    def test_shares_are_randomized(self):
        eng = ShamirSmpcEngine()
        a = eng.split_secret(12345, k=3, n=5)
        b = eng.split_secret(12345, k=3, n=5)
        assert a != b, "share polynomials must use fresh random coefficients"


class TestShamirServiceLayer:
    def test_k_greater_than_n_rejected(self):
        svc = SecretSharing()
        with pytest.raises(ValueError, match="Threshold"):
            svc.generate_shares(100, n=2, k=3)

    def test_too_few_shares_rejected(self):
        svc = SecretSharing()
        svc.generate_shares(100, n=5, k=3)
        with pytest.raises(ValueError):
            svc.reconstruct_secret([(1, 1), (2, 2)])

    def test_round_trip_through_service(self):
        svc = SecretSharing()
        shares = svc.generate_shares(98765, n=5, k=3)
        assert svc.reconstruct_secret(shares[:3]) == 98765

    def test_polynomial_evaluation_mod_prime(self):
        svc = SecretSharing()
        # p(x) = 1 + 2x + 3x^2 at x=4 → 1 + 8 + 48 = 57
        assert svc._evaluate_polynomial([1, 2, 3], 4) == 57
