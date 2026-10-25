"""Normalized density of the existing standalone linear coordinate baseline.

Despite its historical name, this component has no learned Neural ODE or
geographic calibration. W maps row coordinates to a standard Gaussian: z=xW.
"""

import math
from numbers import Real

import numpy as np


class ContinuousNormalizingFlowDensityEstimator:
    """Evaluate the implemented invertible linear map against a Gaussian base."""

    def __init__(self, channels: int = 2):
        if isinstance(channels, bool) or not isinstance(channels, int) or channels <= 0:
            raise ValueError("channels must be a positive integer")
        self.channels = channels
        self.W = np.eye(channels) * 0.75

    @staticmethod
    def _real_matrix(value, name):
        try:
            raw = np.asarray(value)
            complete = np.asarray(value, dtype=object)
            if any(
                isinstance(v, (bool, np.bool_)) or not isinstance(v, Real)
                for v in complete.flat
            ):
                raise ValueError(f"{name} must contain real numeric values")
            if raw.dtype.kind not in "iuf":
                raise ValueError(f"{name} must contain real numeric values")
            result = np.array(raw, dtype=np.float64, copy=True)
        except (TypeError, OverflowError) as exc:
            raise ValueError(f"{name} must contain finite real values") from exc
        if not np.isfinite(result).all():
            raise ValueError(f"{name} must contain finite real values")
        return result

    def log_likelihood_per_coordinate(self, coordinates: np.ndarray) -> np.ndarray:
        """Return normalized per-row log densities from owned model/input copies.

        Invalid windows/models raise ValueError. Arithmetic outside finite
        float64 range raises OverflowError instead of emitting a partial score.
        """
        coords = self._real_matrix(coordinates, "coordinates")
        weights = self._real_matrix(self.W, "W")
        if coords.ndim != 2 or coords.shape[1] != self.channels:
            raise ValueError("coordinates must have shape (N, channels)")
        if weights.shape != (self.channels, self.channels):
            raise ValueError("W must have shape (channels, channels)")
        try:
            with np.errstate(over="raise", invalid="raise", divide="raise"):
                sign, log_det = np.linalg.slogdet(weights)
                if sign == 0 or not math.isfinite(float(log_det)):
                    raise ValueError(
                        "W must be invertible with a finite log determinant"
                    )
                latent = coords @ weights
                # Halve before squaring: sum(z^2)/2 can fit when sum(z^2) cannot.
                half_norm = np.sum((latent / math.sqrt(2.0)) ** 2, axis=1)
                scores = (
                    log_det - self.channels * math.log(2.0 * math.pi) / 2.0 - half_norm
                )
        except (FloatingPointError, np.linalg.LinAlgError) as exc:
            raise OverflowError(
                "linear density arithmetic exceeds finite numeric range"
            ) from exc
        if not np.isfinite(scores).all():
            raise OverflowError(
                "linear density arithmetic exceeds finite numeric range"
            )
        return scores

    def log_likelihood(self, coordinates: np.ndarray) -> float:
        """Independent joint log density; empty (0, channels) has log identity 0."""
        scores = self.log_likelihood_per_coordinate(coordinates)
        try:
            result = math.fsum(float(score) for score in scores)
        except OverflowError as exc:
            raise OverflowError(
                "joint log density exceeds finite numeric range"
            ) from exc
        if not math.isfinite(result):
            raise OverflowError("joint log density exceeds finite numeric range")
        return result

    def predict_congestion_density(self, route_coordinates: list) -> dict:
        """Legacy joint-density display, with explicit numeric range metadata."""
        coordinates = route_coordinates
        if isinstance(coordinates, list) and not coordinates:
            coordinates = np.empty((0, self.channels))
        # Admit inputs separately so invalid data is never hidden by range status.
        try:
            likelihood = self.log_likelihood(coordinates)
        except OverflowError:
            return {
                "coordinate_count": len(coordinates),
                "log_likelihood": None,
                "estimated_density": None,
                "congestion_level": "UNKNOWN",
                "density_underflow": False,
                "numeric_range_failure": True,
                "density_semantics": "independent_joint_linear_gaussian",
            }
        try:
            density = math.exp(likelihood)
        except OverflowError:
            density = None
        return {
            "coordinate_count": len(coordinates),
            "log_likelihood": round(likelihood, 4),
            "estimated_density": None if density is None else round(density, 6),
            "congestion_level": "UNKNOWN"
            if len(coordinates) == 0
            else ("HIGH" if likelihood > math.log(0.05) else "LOW"),
            "density_underflow": density == 0.0,
            "numeric_range_failure": density is None,
            "density_semantics": "independent_joint_linear_gaussian",
        }


cnf_estimator = ContinuousNormalizingFlowDensityEstimator()
