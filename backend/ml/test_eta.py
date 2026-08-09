import os
import requests
import json
import time

BASE_URL = "http://localhost:8000"
API_KEY = os.environ.get("ML_API_KEY", "")

def test_eta_prediction():
    print("🚀 Testing ETA Prediction...")

    headers = {"X-API-Key": API_KEY}

    # 1. Predict ETA
    response = requests.post(f"{BASE_URL}/eta/predict", json={
        "order_id": "test_123",
        "source_lat": 28.6139,
        "source_lng": 77.2090,
        "dest_lat": 28.7041,
        "dest_lng": 77.1025
    }, headers=headers)
    print("Prediction:", response.json())

    # 2. Update ETA with real tracking coordinates
    response = requests.post(f"{BASE_URL}/eta/update/test_123", json={
        "current_lat": 28.6139,
        "current_lng": 77.2090,
        "dest_lat": 28.7041,
        "dest_lng": 77.1025
    }, headers=headers)
    print("Real-time ETA:", response.json())

    # 3. Get traffic
    response = requests.get(f"{BASE_URL}/eta/traffic/test_123", headers=headers)
    print("Traffic:", response.json())

    # 4. Get forecast
    response = requests.get(f"{BASE_URL}/eta/forecast/test_123?hours=2", headers=headers)
    print("Forecast:", response.json())

if __name__ == "__main__":
    test_eta_prediction()