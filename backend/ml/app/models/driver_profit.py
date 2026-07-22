"""Driver Profit Predictor – estimates net earnings before a driver accepts a load.

Uses a ``GradientBoostingRegressor`` trained on synthetic Indian freight
economics data.  Confidence intervals are derived from an ensemble of base
estimators (staged predictions' standard deviation).

NOTE: This module currently trains on synthetic data as a placeholder.
Replace ``_generate_synthetic_data`` with a real data pipeline to make
predictions meaningful.
"""

import logging
from typing import Optional

import numpy as np
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

from .base import save_model, load_model, model_exists

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
    np.random.seed(42)

    route_distance = np.random.uniform(50, 2000, n_samples)                 # km
    fuel_price = np.random.uniform(95, 115, n_samples)                      # ₹/L
    toll_estimate = route_distance * np.random.uniform(1.5, 4.0, n_samples) # ₹
    truck_mileage = np.random.uniform(3, 8, n_samples)                      # km/L
    cargo_weight = np.random.uniform(500, 25_000, n_samples)                # kg
    avg_speed = np.random.uniform(40, 60, n_samples)                        # km/h
    trip_duration = route_distance / avg_speed                               # hours

    # Revenue model
    base_rate = np.random.uniform(1.8, 3.5, n_samples)                     # ₹/km base
    weight_factor = 1 + (cargo_weight / 25_000) * 0.5                       # heavier → more ₹
    revenue = base_rate * route_distance * weight_factor

    # Costs
    fuel_cost = (route_distance / truck_mileage) * fuel_price
    maintenance = route_distance * np.random.uniform(0.8, 2.0, n_samples)  # ₹/km

    net_profit = revenue - fuel_cost - toll_estimate - maintenance
    # Add noise
    net_profit += np.random.normal(0, 500, n_samples)

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


# ---------------------------------------------------------------------------
# Predictor class
# ---------------------------------------------------------------------------


class DriverProfitPredictor:
    """Gradient-boosting model that predicts net driver profit for a trip."""

    def __init__(self) -> None:
        self.model: Optional[GradientBoostingRegressor] = None

    # -- persistence --------------------------------------------------------

    def train(self) -> dict:
        """Train on synthetic data and persist via ``base.save_model``."""
        X, y = _generate_synthetic_data()
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42,
        )

        self.model = GradientBoostingRegressor(
            n_estimators=200,
            max_depth=5,
            learning_rate=0.1,
            random_state=42,
        )
        self.model.fit(X_train, y_train)

        y_pred = self.model.predict(X_test)
        mae = mean_absolute_error(y_test, y_pred)
        rmse = float(np.sqrt(mean_squared_error(y_test, y_pred)))
        r2 = r2_score(y_test, y_pred)

        metrics = {
            "mae": float(mae),
            "rmse": rmse,
            "r2": float(r2),
            "n_samples": len(X),
            "feature_names": FEATURE_NAMES,
        }

        save_model(self.model, MODEL_NAME, metrics)
        logger.info("Driver-profit model trained. R2: %.3f, MAE: %.1f", r2, mae)
        return metrics

    def load(self) -> None:
        """Load a persisted model, auto-training if none exists."""
        if not model_exists(MODEL_NAME):
            self.train()
            return

        loaded = load_model(MODEL_NAME)
        if loaded is None:
            self.train()
            return
        self.model = loaded

    # -- inference ----------------------------------------------------------

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
        if self.model is None:
            self.load()

        features = np.array([[
            route_distance,
            fuel_price,
            toll_estimate,
            truck_mileage,
            cargo_weight,
            trip_duration,
        ]])

        prediction = float(self.model.predict(features)[0])

        # Confidence interval.
        # `staged_predict` yields the CUMULATIVE prediction after each boosting
        # stage (starting near 0 and climbing to the final value). Taking the
        # std-dev across those cumulative values measures training progression,
        # not posterior uncertainty, and can produce negative bounds. Instead we
        # use the spread of the per-stage (per-tree) *contributions*, which is a
        # meaningful proxy for model disagreement/uncertainty, and we clamp the
        # lower bound to be non-negative.
        staged_preds = np.array(
            [pred for pred in self.model.staged_predict(features)]
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
