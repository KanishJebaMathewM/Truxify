from fastapi import APIRouter
from typing import List
from pydantic import BaseModel

router = APIRouter(prefix="/ml", tags=["ML"])

class DemandZone(BaseModel):
    lat: float
    lng: float
    intensity: float  # 0.0 (low) to 1.0 (high)
    label: str

class DemandHeatmapResponse(BaseModel):
    zones: List[DemandZone]
    forecast_hours: int

from datetime import datetime, timedelta
import random
from app.models.demand_forecast import predict_demand

@router.get("/demand-heatmap", response_model=DemandHeatmapResponse)
async def get_demand_heatmap(hours: int = 48):
    """
    Returns demand heatmap data for the next N hours using ML model inference (Model #9).
    """
    base_zones = [
        {"lat": 19.0760, "lng": 72.8777, "label": "Mumbai"},
        {"lat": 28.6139, "lng": 77.2090, "label": "Delhi"},
        {"lat": 12.9716, "lng": 77.5946, "label": "Bengaluru"},
        {"lat": 17.3850, "lng": 78.4867, "label": "Hyderabad"},
        {"lat": 22.5726, "lng": 88.3639, "label": "Kolkata"},
        {"lat": 13.0827, "lng": 80.2707, "label": "Chennai"},
        {"lat": 23.0225, "lng": 72.5714, "label": "Ahmedabad"},
    ]

    now = datetime.now()
    target_time = now + timedelta(hours=hours)
    hour = target_time.hour
    day_of_week = target_time.weekday()
    is_weekend = 1 if day_of_week >= 5 else 0

    zones = []
    for zone in base_zones:
        # Generate varied but reasonable inputs for each zone
        temperature = 25.0 + random.uniform(-5, 10)
        precipitation = random.uniform(0, 5)
        historical_volume = random.randint(30, 80)
        nearby_drivers = random.randint(5, 30)

        features = [
            hour,
            day_of_week,
            is_weekend,
            temperature,
            precipitation,
            historical_volume,
            nearby_drivers
        ]

        try:
            # predict_demand uses Model #9
            pred = predict_demand(features)
            # Normalize to 0.0 - 1.0 (assuming typical max demand is around 100)
            intensity = min(max(pred / 100.0, 0.0), 1.0)
        except Exception:
            intensity = 0.5  # fallback if model fails

        zones.append({
            "lat": zone["lat"],
            "lng": zone["lng"],
            "intensity": round(intensity, 2),
            "label": zone["label"]
        })

    return {"zones": zones, "forecast_hours": hours}
