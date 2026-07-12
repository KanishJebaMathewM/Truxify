import logging
import numpy as np
from typing import List, Optional
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

from .base import save_model, load_model, model_exists

logger = logging.getLogger(__name__)

MODEL_NAME = "demand_forecast"

# Module-level cache to avoid reloading from disk on every call
_model_cache = None

# NOTE: This module currently trains on synthetic (randomly generated) data
# as a placeholder. Replace generate_synthetic_demand_data() with a real
# data pipeline that loads historical trip/demand data from PostgreSQL or
# MongoDB to make predictions meaningful.


def generate_synthetic_demand_data(n_samples: int = 2000) -> tuple:
    np.random.seed(42)
    hour = np.random.randint(0, 24, n_samples)
    day_of_week = np.random.randint(0, 7, n_samples)
    is_weekend = (day_of_week >= 5).astype(int)
    temperature = np.random.normal(25, 10, n_samples)
    precipitation = np.random.exponential(2, n_samples)
    historical_volume = np.random.poisson(50, n_samples)
    nearby_drivers = np.random.poisson(15, n_samples)

    demand = (
        20
        + 10 * np.sin(2 * np.pi * (hour - 6) / 24)
        + 5 * is_weekend
        - 0.2 * temperature
        - 2 * precipitation
        + 0.3 * historical_volume
        + 1.5 * nearby_drivers
        + np.random.normal(0, 5, n_samples)
    )
    demand = np.maximum(demand, 0)

    X = np.column_stack([hour, day_of_week, is_weekend, temperature, precipitation, historical_volume, nearby_drivers])
    y = demand
    return X, y


FEATURE_NAMES = [
    "hour",
    "day_of_week",
    "is_weekend",
    "temperature",
    "precipitation",
    "historical_volume",
    "nearby_drivers",
]


def train_demand_forecast_model() -> dict:
    X, y = generate_synthetic_demand_data()
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    model = GradientBoostingRegressor(
        n_estimators=200,
        max_depth=5,
        learning_rate=0.1,
        random_state=42,
    )
    model.fit(X_train_scaled, y_train)

    y_pred = model.predict(X_test_scaled)
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

    save_model((model, scaler), MODEL_NAME, metrics)
    logger.info("Demand forecast model trained. R2: %.3f, MAE: %.3f", r2, mae)
    return metrics


def predict_demand(features: List[float]) -> Optional[float]:
    if len(features) != len(FEATURE_NAMES):
        raise ValueError(f"Invalid input tensor shape. Expected {len(FEATURE_NAMES)} features, got {len(features)}")

    global _model_cache
    if _model_cache is None:
        if not model_exists(MODEL_NAME):
            train_demand_forecast_model()

        loaded = load_model(MODEL_NAME)
        if loaded is None:
            train_demand_forecast_model()
            loaded = load_model(MODEL_NAME)
            if loaded is None:
                return None

        _model_cache = loaded

    model, scaler = _model_cache
    X = np.array(features).reshape(1, -1)
    X_scaled = scaler.transform(X)
    pred = model.predict(X_scaled)[0]
    return round(float(max(pred, 0)), 2)
