import requests
import json
import os
import sys
from fastapi.testclient import TestClient

BASE_URL = "http://localhost:8000"

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from main import app

client = TestClient(app, headers={'X-API-Key': 'test_key'})


def predict_payload(distance, speed):
    return {
        "order_id": "order_001",
        "features": {
            "distance": distance,
            "time_of_day": 10,
            "day_of_week": 2,
            "route_type": "highway",
            "historical_speed": speed,
        },
    }


def test_predict_output_varies_with_features():
    near = client.post("/ab-testing/predict", json=predict_payload(100, 65))
    far = client.post("/ab-testing/predict", json=predict_payload(900, 30))

    assert near.status_code == 200
    assert far.status_code == 200

    assert near.json()["predicted_eta"] != far.json()["predicted_eta"]


def test_predict_requires_distance_feature():
    response = client.post("/ab-testing/predict", json={
        "order_id": "order_001",
        "features": {"weight": 500, "route": "Mumbai-Delhi"},
    })
    assert response.status_code == 422


def test_status_hides_internal_config():
    response = client.get("/ab-testing/status")
    assert response.status_code == 200
    data = response.json()
    assert "traffic_split" not in data
    assert "threshold" not in data
    assert "active_test" in data


def test_ab_pipeline():
    # 1. Get prediction
    response = requests.post(f"{BASE_URL}/ab-testing/predict", json={
        "order_id": "test_001",
        "features": {"distance": 100, "weight": 500, "route": "Mumbai-Delhi"}
    })
    print("Prediction:", response.json())
    
    # 2. Log metrics
    response = requests.post(f"{BASE_URL}/ab-testing/metrics", json={
        "test_id": "test_001",
        "model_version": "shadow",
        "metrics": {"rmse": 2.1, "mae": 1.5, "accuracy": 0.89}
    })
    print("Metrics logged:", response.json())
    
    # 3. Evaluate test
    response = requests.get(f"{BASE_URL}/ab-testing/evaluate/test_001")
    print("Evaluation:", response.json())
    
    # 4. Trigger rollback
    response = requests.post(f"{BASE_URL}/ab-testing/rollback/test_001")
    print("Rollback:", response.json())

if __name__ == "__main__":
    test_ab_pipeline()