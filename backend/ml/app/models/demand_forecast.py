import logging
import os
import time
import numpy as np
from typing import List, Optional
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

from .base import save_model, load_model, model_exists, get_model_meta, restore_previous_model

logger = logging.getLogger(__name__)

MODEL_NAME = "demand_forecast"

# Module-level cache to avoid reloading from disk on every call
_model_cache = None


def reset_model_cache():
    """Reset the in-memory model cache so the next prediction loads from disk."""
    global _model_cache
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


# A newly trained model is only promoted to production if its MAE beats the
# current production MAE by at least this fraction. A small positive
# tolerance (rather than requiring strict improvement) avoids flapping
# between near-identical models on noisy synthetic data.
#
# Configurable via the PROMOTION_MAE_IMPROVEMENT_THRESHOLD env var so the
# gate can be tuned per-environment without a code change; falls back to
# the 0.01 default if unset, unparsable, or negative.
DEFAULT_PROMOTION_MAE_IMPROVEMENT_THRESHOLD = 0.01


def _load_promotion_mae_improvement_threshold() -> float:
    raw = os.environ.get("PROMOTION_MAE_IMPROVEMENT_THRESHOLD", str(DEFAULT_PROMOTION_MAE_IMPROVEMENT_THRESHOLD))
    try:
        value = float(raw)
    except (TypeError, ValueError):
        logger.warning(
            "Invalid PROMOTION_MAE_IMPROVEMENT_THRESHOLD=%r; falling back to default %.4f.",
            raw, DEFAULT_PROMOTION_MAE_IMPROVEMENT_THRESHOLD,
        )
        return DEFAULT_PROMOTION_MAE_IMPROVEMENT_THRESHOLD

    if value < 0:
        logger.warning(
            "PROMOTION_MAE_IMPROVEMENT_THRESHOLD=%s is negative; falling back to default %.4f.",
            value, DEFAULT_PROMOTION_MAE_IMPROVEMENT_THRESHOLD,
        )
        return DEFAULT_PROMOTION_MAE_IMPROVEMENT_THRESHOLD

    return value


PROMOTION_MAE_IMPROVEMENT_THRESHOLD = _load_promotion_mae_improvement_threshold()


def train_demand_forecast_model() -> dict:
    global _model_cache
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

    # Gate deployment: only overwrite the production model if the new one is
    # actually better than what's currently deployed. Without this, every
    # retraining run silently replaced production regardless of quality,
    # and the README's "auto-rollback" claim had nothing to roll back to
    # even if it were wired up correctly.
    current_meta = get_model_meta(MODEL_NAME)
    current_mae = (current_meta or {}).get("metrics", {}).get("mae")

    promoted = True
    reason = "No existing production model; first training run promoted."
    if current_mae is not None:
        improvement = (current_mae - mae) / current_mae if current_mae else 0.0
        if improvement >= PROMOTION_MAE_IMPROVEMENT_THRESHOLD:
            reason = f"New model MAE {mae:.4f} improved on production MAE {current_mae:.4f} by {improvement:.2%}."
        else:
            promoted = False
            reason = (
                f"New model MAE {mae:.4f} did not improve on production MAE {current_mae:.4f} "
                f"by the required {PROMOTION_MAE_IMPROVEMENT_THRESHOLD:.0%} threshold "
                f"(delta {improvement:.2%}); keeping existing production model."
            )

    metrics["promoted"] = promoted
    metrics["promotion_reason"] = reason

    if promoted:
        training_meta = {
            "source": "module_trained",
            "training_timestamp": time.time(),
            "feature_hash": str(hash(tuple(FEATURE_NAMES))),
        }
        save_model((model, scaler), MODEL_NAME, metrics, training_meta=training_meta)
        # Invalidate the in-memory cache so the next predict_demand call
        # loads the newly trained model instead of the stale cached copy
        reset_model_cache()
        logger.info("Demand forecast model trained and PROMOTED. R2: %.3f, MAE: %.3f", r2, mae)
    else:
        logger.info("Demand forecast model trained but NOT promoted. %s", reason)

    return metrics


def rollback_demand_forecast_model() -> dict:
    """Roll back the demand-forecast model to its previously-promoted version.

    Returns a dict describing whether a rollback actually happened, so the
    caller (the /train/demand/rollback endpoint, and ultimately the n8n
    retraining workflow) gets a real, truthful result instead of the old
    trigger_rollback()-style no-op that only logged and returned a
    hardcoded-looking payload.
    """
    global _model_cache
    restored = restore_previous_model(MODEL_NAME)
    if restored:
        reset_model_cache()
        meta = get_model_meta(MODEL_NAME) or {}
        logger.warning("Demand forecast model rolled back to previous version.")
        return {"rolled_back": True, "metrics": meta.get("metrics", {})}

    logger.warning("Demand forecast rollback requested but no previous version exists.")
    return {"rolled_back": False, "reason": "No previous version available to roll back to."}


def predict_demand(features: List[float]) -> Optional[float]:
    if len(features) != len(FEATURE_NAMES):
        raise ValueError(f"Invalid input tensor shape. Expected {len(FEATURE_NAMES)} features, got {len(features)}")

    global _model_cache
    if _model_cache is None:
        if not model_exists(MODEL_NAME):
            raise RuntimeError(
                "Demand model artifact missing. Refusing to serve synthetic forecasts. "
                "Run the training endpoint on real booking data and ship the artifact."
            )
        loaded = load_model(MODEL_NAME)
        if loaded is None:
            raise RuntimeError("Corrupt demand model artifact: failed to load model from disk.")

        # Verify the loaded model is not a synthetic-trained artifact.
        meta = get_model_meta(MODEL_NAME) or {}
        training_meta = meta.get("training_meta", {})
        if training_meta.get("source") == "synthetic":
            raise RuntimeError("Refusing to serve a demand model trained on synthetic data.")

        _model_cache = loaded

    model, scaler = _model_cache
    X = np.array(features).reshape(1, -1)
    X_scaled = scaler.transform(X)
    pred = model.predict(X_scaled)[0]
    return round(float(max(pred, 0)), 2)
