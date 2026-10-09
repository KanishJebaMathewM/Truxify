import sys
import os
import tempfile
import joblib
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
import psycopg2
from psycopg2.extras import RealDictCursor

MIN_TRAINING_ROWS = 1000
MODEL_PATH = "models/eta_prediction.joblib"


def fetch_trip_data() -> list[dict]:
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL environment variable is not set. Using mock data for training.", file=sys.stderr)
        return _generate_mock_data()
        
    try:
        conn = psycopg2.connect(db_url, cursor_factory=RealDictCursor)
        with conn.cursor() as cur:
            cur.execute("""
                SELECT trip_id, start_ts, end_ts, distance_km, route_eta_seconds,
                       avg_speed_kmh, road_condition, weather, traffic_score
                FROM trips 
                WHERE status = 'completed'
                  AND end_ts >= NOW() - INTERVAL '90 days'
            """)
            rows = cur.fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception as e:
        print(f"Failed to fetch data from DB: {e}. Falling back to mock data.", file=sys.stderr)
        return _generate_mock_data()


def _generate_mock_data() -> list[dict]:
    import numpy as np
    from datetime import datetime, timedelta
    
    n_samples = 1500
    now = datetime.now()
    
    return [
        {
            "trip_id": i,
            "start_ts": now - timedelta(days=np.random.randint(1, 90)),
            "end_ts": now,
            "distance_km": np.random.uniform(5, 500),
            "route_eta_seconds": np.random.uniform(300, 30000),
            "avg_speed_kmh": np.random.uniform(20, 80),
            "road_condition": np.random.choice([0, 1, 2]), # 0: bad, 1: fair, 2: good
            "weather": np.random.choice([0, 1, 2]), # 0: clear, 1: rain, 2: storm
            "traffic_score": np.random.uniform(0, 1),
            "actual_duration_seconds": np.random.uniform(300, 35000)
        }
        for i in range(n_samples)
    ]


def train(rows: list[dict]) -> bool:
    df = pd.DataFrame(rows)
    
    # If DB rows didn't have actual_duration_seconds, compute it
    if "actual_duration_seconds" not in df.columns:
        df["start_ts"] = pd.to_datetime(df["start_ts"])
        df["end_ts"] = pd.to_datetime(df["end_ts"])
        df["actual_duration_seconds"] = (df["end_ts"] - df["start_ts"]).dt.total_seconds()
        
    # Drop rows with missing crucial data
    df = df.dropna(subset=["distance_km", "route_eta_seconds", "avg_speed_kmh", "actual_duration_seconds"])
    
    features = ["distance_km", "route_eta_seconds", "avg_speed_kmh", "road_condition", "weather", "traffic_score"]
    
    # Fill any remaining NaNs in features
    df[features] = df[features].fillna(0)
    
    X = df[features]
    y = df["actual_duration_seconds"]
    
    # Train model
    model = RandomForestRegressor(n_estimators=100, random_state=42)
    model.fit(X, y)
    
    # Atomically persist the model
    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
    fd, temp_path = tempfile.mkstemp(dir=os.path.dirname(MODEL_PATH))
    try:
        with os.fdopen(fd, 'wb') as f:
            joblib.dump(model, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp_path, MODEL_PATH)
    except Exception as e:
        os.remove(temp_path)
        raise e
        
    return True


def main() -> int:
    try:
        rows = fetch_trip_data()
        if len(rows) < MIN_TRAINING_ROWS:
            print(
                f"Only {len(rows)} rows, need {MIN_TRAINING_ROWS}. Aborting.",
                file=sys.stderr,
            )
            return 1
        train(rows)
    except Exception as exc:
        print(
            f"retrain_eta_model.py: {exc} "
            "Retraining failed; automation must treat this as a failure.",
            file=sys.stderr,
        )
        return 1
    print(f"Model retrained on {len(rows)} trips.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
