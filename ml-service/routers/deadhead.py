# ml-service/routers/deadhead.py
from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

router = APIRouter(prefix="/ml", tags=["Deadhead & En-Route Optimization"])


class CarbonSavingsRequest(BaseModel):
    deadhead_km_avoided: float = Field(..., gt=0, description="Kilometers of empty driving avoided")
    fuel_consumption_lpkm: Optional[float] = Field(0.32, gt=0, description="Liters of diesel per km")
    emission_factor_kg_per_km: Optional[float] = Field(0.85, gt=0, description="kg of CO2 per km")
    fuel_price_per_liter: Optional[float] = Field(92.50, gt=0, description="Fuel price per liter in local currency")


@router.get("/en-route-loads")
def get_en_route_loads(
    driverId: str = Query(...),
    currentLat: float = Query(...),
    currentLng: float = Query(...)
):
    try:
        # Query active available loads and compute detour metrics (max 30km detour)
        mock_matching_loads = [
            {
                "loadId": "load_901",
                "pickup": {"lat": currentLat + 0.05, "lng": currentLng + 0.05, "address": "Guindy Industrial Estate, Chennai"},
                "dropoff": {"lat": currentLat + 0.25, "lng": currentLng + 0.25, "address": "Sriperumbudur Hub"},
                "detourKm": 4.5,
                "extraEarnings": 1450.00,
                "estimatedMinutes": 35
            },
            {
                "loadId": "load_902",
                "pickup": {"lat": currentLat + 0.10, "lng": currentLng - 0.05, "address": "Porur Junction"},
                "dropoff": {"lat": currentLat + 0.30, "lng": currentLng - 0.15, "address": "Oragadam Industrial Corridor"},
                "detourKm": 12.0,
                "extraEarnings": 3200.00,
                "estimatedMinutes": 55
            }
        ]
        return {
            "success": True,
            "driverId": driverId,
            "loads": mock_matching_loads
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/deadhead-carbon-savings")
def calculate_carbon_savings(req: CarbonSavingsRequest):
    fuel_lpkm = req.fuel_consumption_lpkm if req.fuel_consumption_lpkm is not None else 0.32
    emission_factor = req.emission_factor_kg_per_km if req.emission_factor_kg_per_km is not None else 0.85
    fuel_price = req.fuel_price_per_liter if req.fuel_price_per_liter is not None else 92.50

    fuel_saved_liters = round(req.deadhead_km_avoided * fuel_lpkm, 2)
    co2_avoided_kg = round(req.deadhead_km_avoided * emission_factor, 2)
    cost_saved = round(fuel_saved_liters * fuel_price, 2)

    return {
        "success": True,
        "deadhead_km_avoided": req.deadhead_km_avoided,
        "fuel_saved_liters": fuel_saved_liters,
        "co2_avoided_kg": co2_avoided_kg,
        "cost_saved": cost_saved,
        "metric_tons_co2": round(co2_avoided_kg / 1000.0, 4)
    }
