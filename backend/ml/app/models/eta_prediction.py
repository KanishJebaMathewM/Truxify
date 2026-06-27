import os
import pickle
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split

MODEL_PATH = "app/models/artifacts/eta_predictor.pkl"


class ETAPredictor:
    def __init__(self):
        self.model = None

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
        X, y = self.generate_synthetic_data()

        X_train, _, y_train, _ = train_test_split(
            X, y, test_size=0.2, random_state=42
        )

        self.model = RandomForestRegressor(
            n_estimators=100,
            random_state=42
        )

        self.model.fit(X_train, y_train)

        os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)

        with open(MODEL_PATH, "wb") as f:
            pickle.dump(self.model, f)

    def load(self):
        if not os.path.exists(MODEL_PATH):
            self.train()

        with open(MODEL_PATH, "rb") as f:
            self.model = pickle.load(f)

    def predict(self, distance, time_of_day, day_of_week, route_type, historical_speed):
        if self.model is None:
            self.load()

        route_type_value = 1 if route_type.lower() == "highway" else 0

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