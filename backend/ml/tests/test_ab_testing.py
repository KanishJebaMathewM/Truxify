import requests
import json

BASE_URL = "http://localhost:8000"

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