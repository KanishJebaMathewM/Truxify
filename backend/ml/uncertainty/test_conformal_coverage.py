"""Independent rank, set-membership and strict JSON controls on native NumPy."""

import itertools
import json
import math
from decimal import ROUND_CEILING, Decimal
from fractions import Fraction

import numpy as np
import pytest
from conformal_eta import ConformalEtaEstimator


@pytest.mark.parametrize(
    "n,alpha",
    [
        (6, 0.05),
        (19, 0.05),
        (20, 0.05),
        (9, 0.1),
        (3, 0.5),
        (1, 0.5),
        (1, 0.49),
        (99, 0.01),
    ],
)
def test_independent_decimal_order_statistic(n, alpha):
    scores = np.arange(n, dtype=float)[::-1] / 1000
    estimator = ConformalEtaEstimator(alpha, scores)
    rank = int(
        (Decimal(n + 1) * (1 - Decimal(str(alpha)))).to_integral_value(
            rounding=ROUND_CEILING
        )
    )
    expected = math.inf if rank > n else sorted(scores)[rank - 1]
    assert estimator.calibrate_interval_q_hat() == expected


@pytest.mark.parametrize(
    "n,alpha", [(6, 0.05), (19, 0.05), (7, 0.25), (3, 0.5), (1, 0.5), (9, 0.1)]
)
def test_exhaustive_exchangeable_held_out_ranks(n, alpha):
    # Uniformly choose each held-out rank from n+1 distinct scores; the exact
    # marginal coverage is independent of calibration ordering.
    scores = np.arange(1, n + 2, dtype=float)
    covered = 0
    for index, held_out in enumerate(scores):
        calibration = np.delete(scores, index)
        for order in (calibration, calibration[::-1], np.roll(calibration, 1)):
            q = ConformalEtaEstimator(alpha, order).calibrate_interval_q_hat()
            assert (
                q
                == ConformalEtaEstimator(alpha, calibration).calibrate_interval_q_hat()
            )
        covered += held_out <= q
    assert Fraction(int(covered), n + 1) >= 1 - Fraction(str(alpha))


def test_all_permutations_and_threshold_ties():
    for scores in itertools.permutations([0.0, 0.004, 0.004, 0.01]):
        estimator = ConformalEtaEstimator(0.4, scores)
        assert estimator.calibrate_interval_q_hat() == 0.004
        bounds = estimator.predict_conformal_eta_bounds(1.0)
        assert bounds["lower_bound_eta_minutes"] <= 1.0 - 0.004
        assert bounds["upper_bound_eta_minutes"] >= 1.0 + 0.004


@pytest.mark.parametrize(
    "alpha", [0, 1, -0.1, 1.1, math.nan, math.inf, True, "0.05", 1j]
)
def test_invalid_alpha(alpha):
    with pytest.raises((TypeError, ValueError)):
        ConformalEtaEstimator(alpha)


@pytest.mark.parametrize(
    "scores", [[], [[1, 2]], [math.nan], [math.inf], [-1], [True], ["1"], [1j]]
)
def test_invalid_scores(scores):
    with pytest.raises(ValueError):
        ConformalEtaEstimator(0.5, scores)


@pytest.mark.parametrize("baseline", [-1, math.nan, math.inf, True, "1", 1j, 10**1000])
def test_invalid_baseline(baseline):
    with pytest.raises(ValueError):
        ConformalEtaEstimator().predict_conformal_eta_bounds(baseline)


def test_owned_calibration_and_legacy_attribute_revalidation():
    source = np.array([1.0, 2.0, 3.0])
    estimator = ConformalEtaEstimator(0.5, source)
    source[:] = 99
    assert estimator.calibrate_interval_q_hat() == 2.0
    estimator.calibration_nonconformity_scores = [math.nan]
    with pytest.raises(ValueError):
        estimator.calibrate_interval_q_hat()
    estimator.calibration_nonconformity_scores = [1.0]
    estimator.alpha = 0
    with pytest.raises(ValueError):
        estimator.predict_conformal_eta_bounds(2.0)


@pytest.mark.parametrize(
    "scores,baseline",
    [
        ([0.004], 1.0),
        ([0.0], 0.0),
        ([float(np.finfo(float).max)], float(np.finfo(float).max)),
    ],
)
def test_finite_membership_and_strict_json(scores, baseline):
    estimator = ConformalEtaEstimator(0.5, scores)
    output = estimator.predict_conformal_eta_bounds(baseline)
    json.dumps(output, allow_nan=False)
    assert output["lower_bound_eta_minutes"] <= max(0.0, baseline - scores[0])
    assert (
        output["upper_bound_eta_minutes"] is None
        or output["upper_bound_eta_minutes"] >= baseline + scores[0]
    )
    assert output["conformal_q_hat_margin"] == scores[0]
    assert output["calibration_source"] == "provided"


def test_default_unbounded_json_and_conditional_metadata():
    output = ConformalEtaEstimator().predict_conformal_eta_bounds(60.0)
    assert (
        json.loads(json.dumps(output, allow_nan=False))["upper_bound_eta_minutes"]
        is None
    )
    assert output["calibration_rank"] == 7
    assert output["calibration_size"] == 6
    assert output["calibration_rank_unbounded"]
    assert "exchangeable" in output["coverage_assumptions"]
    assert output["calibration_source"] == "demonstration"


def test_boundary_nextafter_changes_rank_without_epsilon_tolerance():
    scores = np.arange(1, 20, dtype=float)
    assert ConformalEtaEstimator(0.05, scores).calibrate_interval_q_hat() == 19.0
    assert math.isinf(
        ConformalEtaEstimator(np.nextafter(0.05, 0), scores).calibrate_interval_q_hat()
    )
    assert (
        ConformalEtaEstimator(np.nextafter(0.05, 1), scores).calibrate_interval_q_hat()
        == 19.0
    )


def test_legacy_api_exact_seven_rank_counterexample():
    covered = 0
    for held_out in range(1, 8):
        estimator = ConformalEtaEstimator(0.05)
        estimator.calibration_nonconformity_scores = np.array(
            [x for x in range(1, 8) if x != held_out]
        )
        covered += held_out <= estimator.calibrate_interval_q_hat()
    assert covered == 7


def test_legacy_api_subcent_threshold_membership():
    estimator = ConformalEtaEstimator(0.5)
    estimator.calibration_nonconformity_scores = np.array([0.004])
    bounds = estimator.predict_conformal_eta_bounds(1.0)
    assert bounds["lower_bound_eta_minutes"] <= 0.996
    assert bounds["upper_bound_eta_minutes"] >= 1.004
