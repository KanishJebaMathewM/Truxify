"""Driver Profit Predictor – estimates net earnings before a driver accepts a load.

Uses a ``GradientBoostingRegressor`` trained on synthetic Indian freight
economics data.  Confidence intervals are derived from an ensemble of base
estimators (staged predictions' standard deviation).

NOTE: This module currently trains on synthetic data as a placeholder.
Replace ``_generate_synthetic_data`` with a real data pipeline to make
predictions meaningful.
"""

import logging
import threading

import numpy as np
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split

from .base import load_model_snapshot, model_exists, save_model

logger = logging.getLogger(__name__)

MODEL_NAME = "driver_profit"


# ---------------------------------------------------------------------------
# Synthetic data generation
# ---------------------------------------------------------------------------


def _generate_synthetic_data(n_samples: int = 2000) -> tuple:
    """Create synthetic training data based on Indian freight economics.

    Returns
    -------
    X : ndarray of shape (n_samples, 6)
        Features: route_distance, fuel_price, toll_estimate, truck_mileage,
        cargo_weight, trip_duration.
    y : ndarray of shape (n_samples,)
        Target: net profit (₹).
    """
    # Own the stream per invocation while preserving legacy seed42 draws.
    rng = np.random.RandomState(42)

    route_distance = rng.uniform(50, 2000, n_samples)                 # km
    fuel_price = rng.uniform(95, 115, n_samples)                      # ₹/L
    toll_estimate = route_distance * rng.uniform(1.5, 4.0, n_samples) # ₹
    truck_mileage = rng.uniform(3, 8, n_samples)                      # km/L
    cargo_weight = rng.uniform(500, 25_000, n_samples)                # kg
    avg_speed = rng.uniform(40, 60, n_samples)                        # km/h
    trip_duration = route_distance / avg_speed                               # hours

    # Revenue model
    base_rate = rng.uniform(1.8, 3.5, n_samples)                     # ₹/km base
    weight_factor = 1 + (cargo_weight / 25_000) * 0.5                       # heavier → more ₹
    revenue = base_rate * route_distance * weight_factor

    # Costs
    fuel_cost = (route_distance / truck_mileage) * fuel_price
    maintenance = route_distance * rng.uniform(0.8, 2.0, n_samples)  # ₹/km

    net_profit = revenue - fuel_cost - toll_estimate - maintenance
    # Add noise
    net_profit += rng.normal(0, 500, n_samples)

    X = np.column_stack([
        route_distance,
        fuel_price,
        toll_estimate,
        truck_mileage,
        cargo_weight,
        trip_duration,
    ])

    return X, net_profit


FEATURE_NAMES = [
    "route_distance",
    "fuel_price",
    "toll_estimate",
    "truck_mileage",
    "cargo_weight",
    "trip_duration",
]

# These are the feature-domain bounds used to generate the training data.
# They are persisted with each model generation and enforced at inference so
# the regressor does not silently extrapolate beyond its training domain.
TRAINING_FEATURE_RANGES = {
    "route_distance": {"min": 50.0, "max": 2000.0},
    "fuel_price": {"min": 95.0, "max": 115.0},
    "toll_estimate": {"min": 75.0, "max": 8000.0},
    "truck_mileage": {"min": 3.0, "max": 8.0},
    "cargo_weight": {"min": 500.0, "max": 25_000.0},
    "trip_duration": {"min": 50.0 / 60.0, "max": 50.0},
}


def _feature_statistics(X: np.ndarray) -> dict:
    """Return summary statistics for the training features."""
    return {
        name: {
            "mean": float(np.mean(X[:, index])),
            "std": float(np.std(X[:, index])),
        }
        for index, name in enumerate(FEATURE_NAMES)
    }


# ---------------------------------------------------------------------------
# Predictor class
# ---------------------------------------------------------------------------


class DriverProfitPredictor:
    """Gradient-boosting model that predicts net driver profit for a trip."""

    def __init__(self) -> None:
        self.model: GradientBoostingRegressor | None = None
        self.feature_ranges = {
            feature: dict(bounds) for feature, bounds in TRAINING_FEATURE_RANGES.items()
        }
        self._lifecycle_lock = threading.RLock()
        self._state_lock = threading.Lock()

    # -- persistence --------------------------------------------------------

    def train(self) -> dict:
        """Train on synthetic data and persist via ``base.save_model``."""
        with self._lifecycle_lock:
            return self._train_candidate()

    def _train_candidate(self) -> dict:
        """Prepare/persist privately; failures leave the published state intact."""
        X, y = _generate_synthetic_data()
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42,
        )

        candidate = GradientBoostingRegressor(
            n_estimators=200,
            max_depth=5,
            learning_rate=0.1,
            random_state=42,
        )
        candidate.fit(X_train, y_train)

        y_pred = candidate.predict(X_test)
        mae = mean_absolute_error(y_test, y_pred)
        rmse = float(np.sqrt(mean_squared_error(y_test, y_pred)))
        r2 = r2_score(y_test, y_pred)

        feature_ranges = {
            feature: dict(bounds)
            for feature, bounds in TRAINING_FEATURE_RANGES.items()
        }

        metrics = {
            "mae": float(mae),
            "rmse": rmse,
            "r2": float(r2),
            "n_samples": len(X),
            "feature_names": FEATURE_NAMES,
        }
        training_meta = {
            "feature_ranges": feature_ranges,
            "feature_statistics": _feature_statistics(X),
        }

        save_model(candidate, MODEL_NAME, metrics, training_meta=training_meta)
        self._publish(candidate, feature_ranges)
        logger.info("Driver-profit model trained. R2: %.3f, MAE: %.1f", r2, mae)
        return metrics

    def load(self) -> None:
        """Load a persisted model, auto-training if none exists or metadata is incomplete."""
        with self._lifecycle_lock:
            self._load_candidate()

    def _load_candidate(self) -> None:
        """Prepare all domain metadata before making the loaded model visible."""
        if not model_exists(MODEL_NAME):
            self.train()
            return

        snapshot = load_model_snapshot(MODEL_NAME)
        if snapshot is None or snapshot.model is None:
            self.train()
            return

        loaded = snapshot.model
        meta = snapshot.metadata or {}
        training_meta = meta.get("training_meta") or {}
        feature_ranges = training_meta.get("feature_ranges")
        if not isinstance(feature_ranges, dict) or set(feature_ranges) != set(FEATURE_NAMES):
            logger.warning("Driver-profit model has no feature-domain metadata; retraining")
            self.train()
            return

        prepared_ranges = {
            feature: {
                "min": float(feature_ranges[feature]["min"]),
                "max": float(feature_ranges[feature]["max"]),
            }
            for feature in FEATURE_NAMES
        }
        for feature, bounds in prepared_ranges.items():
            if not (np.isfinite(bounds["min"]) and np.isfinite(bounds["max"])):
                raise ValueError(f"Training range for {feature} must be finite")
            if bounds["min"] > bounds["max"]:
                raise ValueError(f"Training range for {feature} is inverted")
        self._publish(loaded, prepared_ranges)

    def _publish(self, model, feature_ranges: dict) -> None:
        """Replace a complete serving pair under the short state lock."""
        with self._state_lock:
            self.model = model
            self.feature_ranges = feature_ranges

    def _capture_state(self) -> tuple:
        """Capture warm state promptly; serialize and recheck cold initialization."""
        with self._state_lock:
            if self.model is not None:
                return self.model, self.feature_ranges
        # Lock order is lifecycle -> state. Never wait on lifecycle while
        # holding state; warm requests do not join a candidate's expensive work.
        with self._lifecycle_lock:
            with self._state_lock:
                needs_load = self.model is None
            if needs_load:
                self._load_candidate()
            with self._state_lock:
                if self.model is None:
                    raise RuntimeError("Driver-profit initialization produced no model")
                return self.model, self.feature_ranges

    # -- inference ----------------------------------------------------------

    def _validate_feature_domain(self, values: dict[str, float], feature_ranges: dict) -> None:
        """Reject requests containing features outside the training domain."""
        for feature, value in values.items():
            if not np.isfinite(value):
                raise ValueError(f"{feature} must be a finite number")

            bounds = feature_ranges.get(feature)
            if not bounds:
                raise ValueError(f"No training range is available for {feature}")

            minimum = bounds["min"]
            maximum = bounds["max"]
            if value < minimum or value > maximum:
                raise ValueError(
                    f"{feature}={value} is outside the model training range "
                    f"[{minimum}, {maximum}]"
                )

    def predict(
        self,
        route_distance: float,
        fuel_price: float,
        toll_estimate: float,
        truck_mileage: float,
        cargo_weight: float,
        trip_duration: float,
    ) -> dict:
        """Predict net profit with confidence interval.

        Parameters
        ----------
        route_distance : float – total km.
        fuel_price     : float – ₹ per litre.
        toll_estimate  : float – estimated toll cost ₹.
        truck_mileage  : float – km per litre.
        cargo_weight   : float – kg.
        trip_duration  : float – hours.

        Returns
        -------
        dict
            ``predicted_profit`` – point estimate (₹).
            ``confidence_interval`` – ``{lower, upper}`` derived from
            ensemble staged-prediction spread.
        """
        model, feature_ranges = self._capture_state()

        values = {
            "route_distance": route_distance,
            "fuel_price": fuel_price,
            "toll_estimate": toll_estimate,
            "truck_mileage": truck_mileage,
            "cargo_weight": cargo_weight,
            "trip_duration": trip_duration,
        }
        self._validate_feature_domain(values, feature_ranges)

        features = np.array([[
            route_distance,
            fuel_price,
            toll_estimate,
            truck_mileage,
            cargo_weight,
            trip_duration,
        ]])

        prediction = float(model.predict(features)[0])

        # Confidence interval.
        # `staged_predict` yields the CUMULATIVE prediction after each boosting
        # stage (starting near 0 and climbing to the final value). Taking the
        # std-dev across those cumulative values measures training progression,
        # not posterior uncertainty, and can produce negative bounds. Instead we
        # use the spread of the per-stage (per-tree) *contributions*, which is a
        # meaningful proxy for model disagreement/uncertainty, and we clamp the
        # lower bound to be non-negative.
        staged_preds = np.array(
            [pred for pred in model.staged_predict(features)]
        ).flatten()
        if len(staged_preds) > 1:
            increments = np.diff(staged_preds)
            std_dev = float(np.std(increments))
        else:
            std_dev = abs(prediction) * 0.1
        # Guarantee a non-trivial, non-negative band.
        std_dev = max(std_dev, abs(prediction) * 0.05)

        lower = max(0.0, prediction - 1.96 * std_dev)
        upper = prediction + 1.96 * std_dev

        return {
            "predicted_profit": round(prediction, 2),
            "confidence_interval": {
                "lower": round(lower, 2),
                "upper": round(upper, 2),
            },
        }


# Module-level singleton (mirrors eta_predictor pattern)
driver_profit_predictor = DriverProfitPredictor()
