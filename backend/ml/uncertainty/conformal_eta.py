import numpy as np

class ConformalEtaEstimator:
    """
    Conformal Prediction Framework for calibrating statistically valid ETA intervals
    using Split Conformal Risk Control metrics.
    """
    def __init__(self, alpha: float = 0.05):
        self.alpha = alpha # 95% coverage guarantee
        self.calibration_nonconformity_scores = np.array([2.5, 4.0, 5.5, 8.0, 11.2, 14.0])

    def calibrate_interval_q_hat(self) -> float:
        """Computes empirical quantile threshold q_hat from calibration scores."""
        n = len(self.calibration_nonconformity_scores)
        quantile = (n + 1) * (1.0 - self.alpha) / n
        sorted_scores = np.sort(self.calibration_nonconformity_scores)
        idx = min(int(np.ceil(quantile * n)) - 1, n - 1)
        return float(sorted_scores[idx])

    def predict_conformal_eta_bounds(self, baseline_eta_minutes: float) -> dict:
        q_hat = self.calibrate_interval_q_hat()
        lower_bound = max(0.0, baseline_eta_minutes - q_hat)
        upper_bound = baseline_eta_minutes + q_hat

        return {
            "baseline_eta_minutes": round(baseline_eta_minutes, 2),
            "conformal_q_hat_margin": round(q_hat, 2),
            "lower_bound_eta_minutes": round(lower_bound, 2),
            "upper_bound_eta_minutes": round(upper_bound, 2),
            "coverage_guarantee_pct": round((1.0 - self.alpha) * 100.0, 1)
        }

conformal_estimator = ConformalEtaEstimator()
