import hashlib
import logging
import os
import pickle
import numpy as np

MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "models_storage")
MODEL_PATH = os.path.join(MODEL_DIR, "eta_predictor.pkl")
MODEL_HASH_PATH = os.path.join(MODEL_DIR, "eta_predictor.sha256")

logger = logging.getLogger(__name__)


class ETAPredictor:
    def __init__(self):
        self.model = None
        self.trained_on = None

    def generate_synthetic_data(self, n=1000):
        np.random.seed(42)

        distance = np.random.uniform(5, 1200, n)
        time_of_day = np.random.randint(0, 24, n)
        day_of_week = np.random.randint(0, 7, n)
        route_type = np.random.choice([0, 1], n)

        historical_speed = np.where(
            route_type == 1,
            np.random.uniform(55, 85, n),
            np.random.uniform(20, 45, n),
        )

        traffic_factor = np.where(
            ((time_of_day >= 8) & (time_of_day <= 11)) |
            ((time_of_day >= 17) & (time_of_day <= 20)),
            1.35,
            1.0,
        )

        weekend_factor = np.where(day_of_week >= 5, 1.1, 1.0)

        eta = (distance / historical_speed) * 60 * traffic_factor * weekend_factor
        eta += np.random.normal(0, 10, n)

        X = np.column_stack([
            distance,
            time_of_day,
            day_of_week,
            route_type,
            historical_speed,
        ])

        return X, eta

    def train(self):
        raise NotImplementedError(
            "Synthetic training is for offline dev only and must never run at load time. "
            "Ship a real trained ETA artifact."
        )

    def _save_hash(self):
        with open(MODEL_PATH, "rb") as f:
            data = f.read()
        h = hashlib.sha256(data).hexdigest()
        with open(MODEL_HASH_PATH, "w") as f:
            f.write(h)

    def _verify_hash(self):
        if not os.path.exists(MODEL_HASH_PATH):
            return False
        with open(MODEL_PATH, "rb") as f:
            data = f.read()
        actual = hashlib.sha256(data).hexdigest()
        with open(MODEL_HASH_PATH, "r") as f:
            expected = f.read().strip()
        return actual == expected

    def load(self):
        if not (os.path.exists(MODEL_PATH) and os.path.exists(MODEL_HASH_PATH)):
            raise RuntimeError(
                f"ETA model artifacts missing: {MODEL_PATH} / {MODEL_HASH_PATH}. "
                "Refusing to serve synthetic-data predictions. Train and ship real artifacts."
            )

        if not self._verify_hash():
            raise RuntimeError(
                f"Corrupt ETA model artifacts: integrity check failed for {MODEL_PATH}. "
                "Refusing to serve predictions. Ship a valid artifact."
            )

        try:
            with open(MODEL_PATH, "rb") as f:
                self.model = pickle.load(f)
        except Exception as exc:
            raise RuntimeError(f"Corrupt ETA model artifacts: {exc}") from exc

        self.trained_on = "real"

    def predict(self, distance, time_of_day, day_of_week, route_type, historical_speed):
        if self.model is None:
            self.load()

        if isinstance(route_type, int):
            route_type_value = route_type
        elif isinstance(route_type, str):
            route_type_value = 1 if route_type.strip().lower() == "highway" else 0
        else:
            route_type_value = 0

        features = np.array([[
            distance,
            time_of_day,
            day_of_week,
            route_type_value,
            historical_speed,
        ]])

        eta = float(self.model.predict(features)[0])

        return {
            "eta_minutes": round(max(eta, 1), 2),
            "confidence_interval": {
                "min": round(max(eta * 0.9, 1), 2),
                "max": round(eta * 1.1, 2),
            },
        }


eta_predictor = ETAPredictor()