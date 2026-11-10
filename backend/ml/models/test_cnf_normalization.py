"""Independent normalization and numerical contract checks of actual source."""

import json
import math

import numpy as np
import pytest
from cnf_density import ContinuousNormalizingFlowDensityEstimator
from scipy.integrate import quad
from scipy.stats import multivariate_normal


@pytest.mark.parametrize(
    "weights",
    [
        [[0.75, 0.0], [0.0, 0.75]],
        [[-2.0, 0.0], [0.0, 0.5]],
        [[2.0, 0.7], [0.3, 1.4]],
        [[0.0, 2.0], [-0.5, 0.0]],
    ],
)
def test_coordinate_scores_match_independent_covariance_gaussian(weights):
    estimator = ContinuousNormalizingFlowDensityEstimator()
    estimator.W = np.array(weights)
    coords = np.random.default_rng(117).normal(size=(80, 2))
    covariance = np.linalg.inv(estimator.W @ estimator.W.T)
    expected = multivariate_normal(cov=covariance).logpdf(coords)
    actual = estimator.log_likelihood_per_coordinate(coords)
    np.testing.assert_allclose(actual, expected, rtol=1e-12, atol=1e-12)
    assert estimator.log_likelihood(coords) == pytest.approx(math.fsum(expected))


@pytest.mark.parametrize("weight", [0.25, 0.75, -2.0, 8.0])
def test_one_dimensional_density_integrates_to_one(weight):
    estimator = ContinuousNormalizingFlowDensityEstimator(channels=1)
    estimator.W[:] = weight
    mass, error = quad(
        lambda x: math.exp(estimator.log_likelihood(np.array([[x]]))),
        -np.inf,
        np.inf,
        epsabs=1e-10,
    )
    assert mass == pytest.approx(1.0, abs=1e-10)
    assert error < 1e-8


def test_zero_coordinate_has_correct_normalized_mass():
    estimator = ContinuousNormalizingFlowDensityEstimator()
    density = math.exp(estimator.log_likelihood(np.zeros((1, 2))))
    assert density == pytest.approx(0.75**2 / (2 * math.pi))


def test_joint_partition_permutation_and_empty_identity():
    estimator = ContinuousNormalizingFlowDensityEstimator()
    data = np.random.default_rng(77).normal(size=(71, 2))
    joint = estimator.log_likelihood(data)
    pieces = [estimator.log_likelihood(chunk) for chunk in np.array_split(data, 13)]
    assert joint == pytest.approx(math.fsum(pieces), rel=1e-14)
    assert joint == pytest.approx(estimator.log_likelihood(data[::-1]), rel=1e-14)
    assert estimator.log_likelihood(np.empty((0, 2))) == 0.0
    assert estimator.predict_congestion_density([])["congestion_level"] == "UNKNOWN"


@pytest.mark.parametrize(
    "matrix",
    [
        [[0.0, 0.0], [0.0, 0.0]],
        [[1.0, 2.0], [2.0, 4.0]],
        [[1.0, float("nan")], [0.0, 1.0]],
        [[1.0, float("inf")], [0.0, 1.0]],
        np.eye(3),
        [[1.0, 2.0]],
        [[1j, 0.0], [0.0, 1.0]],
        [["1", "0"], ["0", "1"]],
    ],
)
def test_invalid_model_rejected_even_for_empty_window(matrix):
    estimator = ContinuousNormalizingFlowDensityEstimator()
    estimator.W = matrix
    with pytest.raises(ValueError):
        estimator.log_likelihood(np.empty((0, 2)))


@pytest.mark.parametrize(
    "coordinates",
    [
        [[1.0, float("inf")]],
        [[float("nan"), 1.0]],
        [1.0, 2.0],
        [[[1.0, 2.0]]],
        [[1.0, 2.0, 3.0]],
        [[1.0, 2.0], [3.0]],
        [["1", "2"]],
        [[1j, 2.0]],
    ],
)
def test_invalid_complete_window_rejected(coordinates):
    estimator = ContinuousNormalizingFlowDensityEstimator()
    with pytest.raises(ValueError):
        estimator.predict_congestion_density(coordinates)


@pytest.mark.parametrize("channels", [0, -1, True, 1.5])
def test_invalid_channel_count(channels):
    with pytest.raises(ValueError):
        ContinuousNormalizingFlowDensityEstimator(channels)


def test_tiny_jacobian_uses_log_determinant_not_underflowed_det():
    estimator = ContinuousNormalizingFlowDensityEstimator()
    estimator.W = np.diag([1e-200, 1e-200])
    score = estimator.log_likelihood(np.zeros((1, 2)))
    assert score == pytest.approx(2 * math.log(1e-200) - math.log(2 * math.pi))


def test_highway_underflow_is_honest_and_json_safe():
    estimator = ContinuousNormalizingFlowDensityEstimator()
    result = estimator.predict_congestion_density(
        [[28.6139, 77.2090], [19.0760, 72.8777]]
    )
    assert result["estimated_density"] == 0.0
    assert result["density_underflow"] is True
    assert result["log_likelihood"] < -1000
    assert result["congestion_level"] == "LOW"
    json.dumps(result, allow_nan=False)


def test_unrepresentable_tail_does_not_emit_infinity_or_fake_density():
    estimator = ContinuousNormalizingFlowDensityEstimator()
    result = estimator.predict_congestion_density([[1e308, 1e308]])
    assert result["numeric_range_failure"] is True
    assert result["log_likelihood"] is None and result["estimated_density"] is None
    assert result["congestion_level"] == "UNKNOWN"
    json.dumps(result, allow_nan=False)


def test_finite_log_with_density_overflow_preserves_log():
    estimator = ContinuousNormalizingFlowDensityEstimator()
    estimator.W = np.eye(2) * 1e200
    result = estimator.predict_congestion_density([[0.0, 0.0]])
    assert result["log_likelihood"] > 700
    assert (
        result["estimated_density"] is None and result["numeric_range_failure"] is True
    )
    assert result["congestion_level"] == "HIGH"
    json.dumps(result, allow_nan=False)


def test_scaled_half_norm_can_fit_despite_unscaled_square_overflow():
    estimator = ContinuousNormalizingFlowDensityEstimator(channels=1)
    estimator.W[:] = 1.0
    result = estimator.log_likelihood(np.array([[1.5e154]]))
    assert math.isfinite(result)
    assert result == pytest.approx(-1.125e308, rel=1e-14)


def test_inputs_and_weights_not_mutated():
    estimator = ContinuousNormalizingFlowDensityEstimator()
    coords = np.array([[1.0, 2.0], [3.0, 4.0]])
    before_coords, before_weights = coords.copy(), estimator.W.copy()
    estimator.log_likelihood(coords)
    np.testing.assert_array_equal(coords, before_coords)
    np.testing.assert_array_equal(estimator.W, before_weights)


@pytest.mark.parametrize("coordinates", [[[True, 2.0]], [[1.0, False]]])
def test_mixed_boolean_window_rejected(coordinates):
    with pytest.raises(ValueError):
        ContinuousNormalizingFlowDensityEstimator().log_likelihood(coordinates)
