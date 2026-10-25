"""Split-conformal absolute-residual intervals for nonnegative ETA targets."""

import math
from fractions import Fraction
from numbers import Real

import numpy as np


class ConformalEtaEstimator:
    """Marginal coverage needs exchangeable held-out scores and a fixed predictor.

    The default six residuals are demonstration data, not a production calibration
    certificate. Alpha is interpreted as its shortest decimal representation.
    """

    def __init__(self, alpha: float = 0.05, calibration_scores=None):
        self._validated_alpha(alpha)
        self.alpha = alpha
        self.calibration_source = (
            "demonstration" if calibration_scores is None else "provided"
        )
        if calibration_scores is None:
            calibration_scores = [2.5, 4.0, 5.5, 8.0, 11.2, 14.0]
        self.calibration_nonconformity_scores = self._validated_scores(
            calibration_scores
        )

    @staticmethod
    def _validated_alpha(alpha):
        if isinstance(alpha, (bool, np.bool_)) or not isinstance(alpha, Real):
            raise TypeError(
                "alpha must be a finite real number strictly between 0 and 1"
            )
        if not 0 < alpha < 1 or not math.isfinite(alpha):
            raise ValueError(
                "alpha must be a finite real number strictly between 0 and 1"
            )
        return Fraction(str(alpha))

    @staticmethod
    def _validated_scores(scores):
        raw = np.asarray(scores)
        if raw.ndim != 1 or raw.size == 0 or raw.dtype.kind not in "iuf":
            raise ValueError("calibration scores must be a nonempty real vector")
        with np.errstate(over="ignore", invalid="ignore"):
            owned = np.array(raw, dtype=np.float64, copy=True)
        if not np.all(np.isfinite(owned)) or np.any(owned < 0):
            raise ValueError(
                "absolute calibration residuals must be finite and nonnegative"
            )
        return owned

    def _calibrate(self):
        # Snapshot public legacy attributes once; callers may replace them.
        alpha = self._validated_alpha(self.alpha)
        scores = self._validated_scores(self.calibration_nonconformity_scores)
        n = scores.size
        # ceil((n+1)*(1-alpha)) == n+1-floor((n+1)*alpha).
        # Rational decimal arithmetic avoids accidental boundary rank changes.
        rank = n + 1 - ((n + 1) * alpha.numerator // alpha.denominator)
        q_hat = (
            math.inf if rank > n else float(np.partition(scores, rank - 1)[rank - 1])
        )
        return q_hat, alpha, n, rank

    def calibrate_interval_q_hat(self) -> float:
        """Return the corrected rank threshold, including +infinity at rank n+1."""
        return self._calibrate()[0]

    def predict_conformal_eta_bounds(self, baseline_eta_minutes: float) -> dict:
        if (
            isinstance(baseline_eta_minutes, (bool, np.bool_))
            or not isinstance(baseline_eta_minutes, Real)
            or baseline_eta_minutes < 0
        ):
            raise ValueError("baseline ETA must be finite and nonnegative")
        try:
            baseline = float(baseline_eta_minutes)
        except OverflowError as exc:
            raise ValueError(
                "baseline ETA must be representable as a finite float"
            ) from exc
        if not math.isfinite(baseline):
            raise ValueError("baseline ETA must be finite and nonnegative")
        q_hat, alpha, n, rank = self._calibrate()
        unbounded = math.isinf(q_hat)
        if unbounded:
            lower, upper = 0.0, None
        else:
            # Outward rounding preserves set membership even at floating-point
            # addition/subtraction boundaries. Never apply display rounding here.
            lower = max(0.0, math.nextafter(baseline - q_hat, -math.inf))
            endpoint = baseline + q_hat
            upper_value = math.nextafter(endpoint, math.inf)
            upper = upper_value if math.isfinite(upper_value) else None
        return {
            "baseline_eta_minutes": baseline,
            "conformal_q_hat_margin": None if unbounded else q_hat,
            "lower_bound_eta_minutes": lower,
            "upper_bound_eta_minutes": upper,
            "interval_unbounded": upper is None,
            "calibration_rank_unbounded": unbounded,
            "calibration_size": int(n),
            "calibration_rank": int(rank),
            "calibration_source": self.calibration_source,
            # Compatibility field: a conditional marginal target, not a measured
            # or verified coverage certificate for these supplied residuals.
            "coverage_guarantee_pct": float((1 - alpha) * 100),
            "coverage_assumptions": "exchangeable held-out calibration/test scores for a fixed predictor; nonnegative ETA targets",
        }


conformal_estimator = ConformalEtaEstimator()
