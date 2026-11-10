import hashlib
import logging
import os
import pickle
import threading
from functools import wraps
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split

MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "models_storage")
MODEL_PATH = os.path.join(MODEL_DIR, "eta_predictor.pkl")
MODEL_HASH_PATH = os.path.join(MODEL_DIR, "eta_predictor.sha256")

logger = logging.getLogger(__name__)


def _model_writer(method):
    @wraps(method)
    def owned(predictor, *args, **kwargs):
        with predictor._lifecycle_lock:
            return method(predictor, *args, **kwargs)
    return owned


class ETAPredictor:
    def __init__(self):
        self.model = None
        self._lifecycle_lock = threading.RLock()
        self._state_lock = threading.Lock()

    def generate_synthetic_data(self, n=1000):
        # Own the stream per invocation while preserving legacy seed42 draws.
        rng = np.random.RandomState(42)

        distance = rng.uniform(5, 1200, n)
        time_of_day = rng.randint(0, 24, n)
        day_of_week = rng.randint(0, 7, n)
        route_type = rng.choice([0, 1], n)

        historical_speed = np.where(
            route_type == 1,
            rng.uniform(55, 85, n),
            rng.uniform(20, 45, n),
        )

        traffic_factor = np.where(
            ((time_of_day >= 8) & (time_of_day <= 11)) |
            ((time_of_day >= 17) & (time_of_day <= 20)),
            1.35,
            1.0,
        )

        weekend_factor = np.where(day_of_week >= 5, 1.1, 1.0)

        eta = (distance / historical_speed) * 60 * traffic_factor * weekend_factor
        eta += rng.normal(0, 10, n)

        X = np.column_stack([
            distance,
            time_of_day,
            day_of_week,
            route_type,
            historical_speed,
        ])

        return X, eta

    @_model_writer
    def train(self):
        candidate = self._fit_and_persist()
        with self._state_lock:
            self.model = candidate

    def _fit_and_persist(self):
        """Prepare privately; the owning train/load operation publishes last."""
        X, y = self.generate_synthetic_data()

        X_train, _, y_train, _ = train_test_split(
            X, y, test_size=0.2, random_state=42
        )

        candidate = RandomForestRegressor(
            n_estimators=100,
            random_state=42
        )

        candidate.fit(X_train, y_train)

        os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)

        with open(MODEL_PATH, "wb") as f:
            pickle.dump(candidate, f)
        self._save_hash()
        return candidate

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

    @_model_writer
    def load(self):
        if not os.path.exists(MODEL_PATH):
            self._fit_and_persist()

        if not self._verify_hash():
            logger.warning("[eta] Model integrity check failed — retraining.")
            os.remove(MODEL_PATH) if os.path.exists(MODEL_PATH) else None
            self._fit_and_persist()
            if not self._verify_hash():
                raise ValueError("Retrained ETA model did not pass its integrity check")

        with open(MODEL_PATH, "rb") as f:
            candidate = pickle.load(f)
        with self._state_lock:
            self.model = candidate

    def predict(self, distance, time_of_day, day_of_week, route_type, historical_speed):
        with self._state_lock:
            model = self.model
        if model is None:
            with self._lifecycle_lock:
                with self._state_lock:
                    model = self.model
                if model is None:
                    self.load()
                    with self._state_lock:
                        model = self.model

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

        eta = float(model.predict(features)[0])

        return {
            "eta_minutes": round(max(eta, 1), 2),
            "confidence_interval": {
                "min": round(max(eta * 0.9, 1), 2),
                "max": round(eta * 1.1, 2),
            },
        }


eta_predictor = ETAPredictor()