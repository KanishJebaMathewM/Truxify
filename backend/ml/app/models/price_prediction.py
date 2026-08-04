import logging
import math
import os
import requests
from datetime import datetime
from typing import Dict, List, Optional

import numpy as np
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

from .base import get_model_meta, load_model, save_model

logger = logging.getLogger(__name__)

MODEL_NAME = "price_forecast"

# Real-data training pipeline: this module only ever fits on completed trips
# loaded from PostgreSQL. The previous synthetic (randomly generated) training
# data has been removed — a model is persisted exclusively via
# train_price_model() over real market rates, and predictions are gated until
# such a model exists.
MIN_REAL_SAMPLES = 100
DEFAULT_FUEL_PRICE = 105.0

TRUCK_TYPE_ENCODING: Dict[str, int] = {
    "light_truck": 0,
    "medium_truck": 1,
    "heavy_truck": 2,
    "trailer": 3,
}

CARGO_TYPE_ENCODING: Dict[str, int] = {
    "general": 0,
    "perishable": 1,
    "fragile": 2,
    "hazardous": 3,
    "bulk": 4,
}

# trucks.truck_type -> price-model truck_type
TRUCK_TYPE_FROM_DB: Dict[str, str] = {
    "Open Body": "light_truck",
    "Closed Body": "medium_truck",
    "Container": "heavy_truck",
    "Refrigerated": "trailer",
}

FEATURE_NAMES = [
    "distance_km",
    "cargo_weight_kg",
    "truck_type",
    "hour_of_day",
    "day_of_week",
    "month",
    "fuel_price",
    "cargo_type",
    "route_origin",
    "route_destination",
]

# Indian state / UT codes, skipped during city extraction from addresses.
_STATE_CODES = {
    "AN", "AP", "AR", "AS", "BR", "CG", "CH", "DD", "DL", "DN", "GA", "GJ",
    "HR", "HP", "JH", "JK", "KA", "KL", "LD", "MP", "MH", "ML", "MN", "MZ",
    "NL", "OD", "PB", "PY", "RJ", "SK", "TN", "TR", "TS", "UP", "UK", "WB",
}


class PriceModelDataUnavailableError(RuntimeError):
    """Raised when the real-data training pipeline has no data to fit on."""


# ---------------------------------------------------------------------------
# Historical data pipeline (PostgreSQL)
# ---------------------------------------------------------------------------

def load_historical_trips(max_samples: int = 20000) -> List[dict]:
    """Load completed-trip pricing history from PostgreSQL.

    Reads the ``orders`` table for delivered / payment-released orders (the
    realised market rates), joining ``trucks`` to recover the vehicle type.
    Returns raw rows; an empty list when the database is unreachable or no
    completed trips exist yet.
    """
    rows: List[dict] = []
    try:
        from sqlalchemy import text
        from app.models.database import engine
    except Exception as exc:  # pragma: no cover - environment specific
        logger.warning("Historical trip loader unavailable (sqlalchemy import): %s", exc)
        return rows

    sql = text(
        """
        SELECT
            o.pickup_address, o.pickup_lat, o.pickup_lng,
            o.drop_address, o.drop_lat, o.drop_lng,
            o.weight_tonnes, o.goods_type, o.created_at,
            o.truck_id, o.bid_amount, o.total_amount,
            t.truck_type
        FROM orders o
        LEFT JOIN trucks t ON t.id = o.truck_id
        WHERE o.status IN ('delivered', 'payment_released')
          AND o.pickup_lat IS NOT NULL AND o.pickup_lng IS NOT NULL
          AND o.drop_lat IS NOT NULL AND o.drop_lng IS NOT NULL
          AND o.weight_tonnes IS NOT NULL AND o.weight_tonnes > 0
          AND (o.bid_amount IS NOT NULL OR o.total_amount IS NOT NULL)
        ORDER BY o.created_at DESC
        LIMIT :max_samples
        """
    )
    try:
        with engine.connect() as conn:
            for row in conn.execute(sql, {"max_samples": max_samples}).mappings():
                rows.append(dict(row))
        logger.info("Loaded %d historical completed trips from PostgreSQL", len(rows))
    except Exception as exc:
        logger.warning("Could not load historical trips from PostgreSQL: %s", exc)
    return rows


def _city_from_address(address) -> str:
    """Best-effort city extraction from a free-text address.

    Drops PIN codes and state/UT abbreviations so ``"Warehouse 0, Mumbai,
    MH 400001"`` yields ``"Mumbai"``. Applied identically during training (from
    ``pickup_address``/``drop_address``) and inference (from
    ``route_origin``/``route_destination``).
    """
    if not address:
        return ""
    tokens = str(address).replace(",", " ").split()
    words: List[str] = []
    for token in tokens:
        cleaned = token.strip(" .-")
        if not cleaned:
            continue
        if cleaned.isdigit() and len(cleaned) == 6:
            continue
        if cleaned.isalpha() and cleaned.upper() in _STATE_CODES:
            continue
        words.append(cleaned)
    if not words:
        return ""
    for word in reversed(words):
        if word.lower() in {
            "warehouse", "godown", "factory", "plot", "near", "opp",
            "opposite", "road", "street", "area", "sector", "colony",
        }:
            continue
        return word
    return words[-1]


def _normalize_cargo_type(goods_type) -> str:
    """Map a free-text goods_type from the app onto the ML cargo taxonomy."""
    g = str(goods_type or "").lower().replace("-", " ").replace("_", " ")
    if any(k in g for k in ("perish", "fresh", "food", "fruit", "vegetable", "milk", "meat", "dairy")):
        return "perishable"
    if any(k in g for k in ("fragil", "glass", "ceramic", "electronics", "appliance")):
        return "fragile"
    if any(k in g for k in ("hazard", "chem", "acid", "fuel", "flammable", "petrol", "diesel")):
        return "hazardous"
    if any(k in g for k in ("bulk", "grain", "sand", "cement", "aggregate", "stone", "coal")):
        return "bulk"
    return "general"


def _normalize_truck_type(truck_type) -> str:
    """Map the trucks.truck_type domain onto the price-model truck taxonomy."""
    raw = str(truck_type or "").strip()
    if not raw:
        return "medium_truck"
    if raw in TRUCK_TYPE_FROM_DB:
        return TRUCK_TYPE_FROM_DB[raw]
    norm = raw.lower().replace(" ", "_").replace("-", "_")
    if norm in TRUCK_TYPE_ENCODING:
        return norm
    if "light" in norm or "open" in norm:
        return "light_truck"
    if "container" in norm:
        return "heavy_truck"
    if "refrig" in norm or "trailer" in norm or "reefer" in norm:
        return "trailer"
    return "medium_truck"


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r_earth = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lng / 2) ** 2
    )
    return r_earth * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _parse_trip_row(row: dict) -> Optional[dict]:
    """Convert a raw orders row into a training sample, or None if unusable."""
    try:
        pickup_lat = float(row.get("pickup_lat"))
        pickup_lng = float(row.get("pickup_lng"))
        drop_lat = float(row.get("drop_lat"))
        drop_lng = float(row.get("drop_lng"))
        weight_kg = float(row.get("weight_tonnes")) * 1000.0
    except (TypeError, ValueError):
        return None

    distance_km = _haversine_km(pickup_lat, pickup_lng, drop_lat, drop_lng)
    if distance_km <= 0 or weight_kg <= 0:
        return None

    created_at = row.get("created_at")
    if isinstance(created_at, datetime):
        hour = created_at.hour
        day_of_week = created_at.weekday()
        month = created_at.month
    else:
        hour, day_of_week, month = 12, 3, 6

    price_paisa = row.get("bid_amount")
    if price_paisa is None:
        price_paisa = row.get("total_amount")
    try:
        price_paisa = float(price_paisa)
    except (TypeError, ValueError):
        return None
    if price_paisa <= 0:
        return None

    return {
        "numeric": [
            distance_km,
            weight_kg,
            TRUCK_TYPE_ENCODING[_normalize_truck_type(row.get("truck_type"))],
            hour,
            day_of_week,
            month,
            DEFAULT_FUEL_PRICE,
            CARGO_TYPE_ENCODING[_normalize_cargo_type(row.get("goods_type"))],
        ],
        "origin": _city_from_address(row.get("pickup_address")),
        "destination": _city_from_address(row.get("drop_address")),
        "price_inr": price_paisa / 100.0,
    }


def _get_weather_multiplier(city: str) -> float:
    """Fetch weather for a city and return a price multiplier."""
    if not city:
        return 1.0
    api_key = os.environ.get("OPENWEATHERMAP_API_KEY")
    if not api_key:
        return 1.0
    try:
        url = f"https://api.openweathermap.org/data/2.5/weather?q={city}&appid={api_key}"
        response = requests.get(url, timeout=2.0)
        if response.status_code == 200:
            weather_main = response.json().get("weather", [{}])[0].get("main", "").lower()
            if weather_main in ["rain", "snow", "thunderstorm", "extreme", "squall", "tornado"]:
                return 1.2
            elif weather_main in ["drizzle", "mist", "fog", "haze", "dust", "sand", "ash"]:
                return 1.1
    except Exception as e:
        logger.warning("Weather API failed for %s: %s", city, e)
    return 1.0


def _build_city_encoder(samples: List[dict]) -> Dict[str, int]:
    """Ordinal city encoder fitted on training origins/destinations."""
    counts: Dict[str, int] = {}
    for sample in samples:
        for city in (sample["origin"], sample["destination"]):
            if city:
                counts[city] = counts.get(city, 0) + 1
    ranked = sorted(counts, key=lambda c: (-counts[c], c))
    return {city: index for index, city in enumerate(ranked)}


def train_price_model(max_samples: int = 20000) -> dict:
    """Train the freight price model on real completed-trip pricing.

    Loads historical orders from PostgreSQL. Raises
    :class:`PriceModelDataUnavailableError` when fewer than ``MIN_REAL_SAMPLES``
    completed trips are available so callers can surface a 503 instead of
    silently fitting on random noise.

    Returns:
        Dictionary of training metrics, flagged as a real-data model.
    """
    samples: List[dict] = []
    for row in load_historical_trips(max_samples=max_samples):
        parsed = _parse_trip_row(row)
        if parsed is not None:
            samples.append(parsed)

    if len(samples) < MIN_REAL_SAMPLES:
        raise PriceModelDataUnavailableError(
            "Insufficient completed trips for training: "
            f"found {len(samples)} of {MIN_REAL_SAMPLES} required. "
            "Train again once more trips have been delivered."
        )

    city_encoder = _build_city_encoder(samples)
    unknown = len(city_encoder)

    X = np.array(
        [
            sample["numeric"]
            + [
                city_encoder.get(sample["origin"], unknown),
                city_encoder.get(sample["destination"], unknown),
            ]
            for sample in samples
        ],
        dtype=float,
    )
    y = np.array([sample["price_inr"] for sample in samples], dtype=float)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )

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
        "data_source": "postgres_completed_trips",
        "is_real_model": True,
        "city_count": len(city_encoder),
    }

    save_model((model, scaler, city_encoder), MODEL_NAME, metrics)
    logger.info(
        "Price model trained on %d real completed trips. R2: %.3f, MAE: %.3f",
        len(X),
        r2,
        mae,
    )
    return metrics


def _model_is_real() -> bool:
    """Only models persisted by the real-data pipeline are served."""
    meta = get_model_meta(MODEL_NAME)
    if meta is None:
        return False
    return bool((meta.get("metrics") or {}).get("is_real_model"))


def predict_price(
    distance_km: float,
    cargo_weight_kg: float,
    truck_type: str = "medium_truck",
    route_origin: str = "",
    route_destination: str = "",
    hour_of_day: int = 12,
    day_of_week: int = 3,
    month: int = 6,
    fuel_price: float = 105.0,
    cargo_type: str = "general",
) -> Optional[dict]:
    """Predict freight price using the trained ML model.

    Only a model persisted by the real-data pipeline is served: when no real
    model has been trained yet this returns ``None`` (never auto-trains on
    synthetic randomness), which callers surface as a 503.

    Args:
        distance_km: Shipping distance in kilometres.
        cargo_weight_kg: Total cargo weight in kilograms.
        truck_type: One of 'light_truck', 'medium_truck', 'heavy_truck', 'trailer'.
        route_origin: Origin location name (used as a categorical geography feature).
        route_destination: Destination location name (used as a categorical geography feature).
        hour_of_day: Hour of departure (0-23).
        day_of_week: Day of week (0=Mon, 6=Sun).
        month: Month of year (1-12).
        fuel_price: Current diesel price in INR per litre.
        cargo_type: One of 'general', 'perishable', 'fragile', 'hazardous', 'bulk'.

    Returns:
        Dict with estimated_price, min_price, max_price, and currency, or None
        when no real-data model is available.

    Raises:
        ValueError: If distance_km or cargo_weight_kg is non-positive.
    """
    if distance_km <= 0:
        raise ValueError("distance_km must be positive")
    if cargo_weight_kg <= 0:
        raise ValueError("cargo_weight_kg must be positive")

    if not _model_is_real():
        return None

    loaded = load_model(MODEL_NAME)
    if loaded is None or not isinstance(loaded, (list, tuple)) or len(loaded) != 3:
        logger.warning("Persisted price model is not a real-data model; ignoring.")
        return None

    model, scaler, city_encoder = loaded
    unknown = len(city_encoder)

    truck_encoded = TRUCK_TYPE_ENCODING.get(
        truck_type.lower().replace(" ", "_"), 1
    )
    cargo_encoded = CARGO_TYPE_ENCODING.get(
        cargo_type.lower().replace(" ", "_"), 0
    )

    features = np.array([[
        distance_km,
        cargo_weight_kg,
        truck_encoded,
        hour_of_day,
        day_of_week,
        month,
        fuel_price,
        cargo_encoded,
        city_encoder.get(_city_from_address(route_origin), unknown),
        city_encoder.get(_city_from_address(route_destination), unknown),
    ]])
    features_scaled = scaler.transform(features)
    predicted = float(model.predict(features_scaled)[0])
    predicted = max(predicted, 500.0)

    origin_city = _city_from_address(route_origin)
    destination_city = _city_from_address(route_destination)
    weather_multiplier = max(
        _get_weather_multiplier(origin_city),
        _get_weather_multiplier(destination_city)
    )
    predicted *= weather_multiplier

    return {
        "estimated_price": round(predicted, 2),
        "min_price": round(predicted * 0.85, 2),
        "max_price": round(predicted * 1.15, 2),
        "currency": "INR",
    }
