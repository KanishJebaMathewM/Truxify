from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import Optional

router = APIRouter(prefix="/ml", tags=["Fuel Surcharge Estimation"])


class FuelSurchargeRequest(BaseModel):
    base_fuel_price_per_liter: float = Field(..., gt=0, description="Contractual baseline fuel price per liter")
    current_fuel_price_per_liter: float = Field(..., gt=0, description="Current regional fuel price per liter")
    route_distance_km: float = Field(..., gt=0, description="Trip distance in km")
    fuel_mileage_km_per_liter: Optional[float] = Field(3.5, gt=0, description="Vehicle fuel efficiency in km/L")
    base_freight_rate: float = Field(..., gt=0, description="Agreed baseline freight cost")


@router.post("/fuel-surcharge")
def calculate_fuel_surcharge(req: FuelSurchargeRequest):
    fuel_diff = req.current_fuel_price_per_liter - req.base_fuel_price_per_liter
    mileage = req.fuel_mileage_km_per_liter if req.fuel_mileage_km_per_liter is not None else 3.5

    liters_consumed = req.route_distance_km / mileage

    if fuel_diff <= 0:
        return {
            "success": True,
            "base_fuel_price": round(req.base_fuel_price_per_liter, 2),
            "current_fuel_price": round(req.current_fuel_price_per_liter, 2),
            "fuel_price_diff": round(fuel_diff, 2),
            "liters_consumed": round(liters_consumed, 2),
            "surcharge_amount": 0.0,
            "surcharge_percent": 0.0,
            "total_freight_cost": round(req.base_freight_rate, 2),
        }

    surcharge_amount = liters_consumed * fuel_diff
    surcharge_percent = (surcharge_amount / req.base_freight_rate) * 100.0
    total_freight_cost = req.base_freight_rate + surcharge_amount

    return {
        "success": True,
        "base_fuel_price": round(req.base_fuel_price_per_liter, 2),
        "current_fuel_price": round(req.current_fuel_price_per_liter, 2),
        "fuel_price_diff": round(fuel_diff, 2),
        "liters_consumed": round(liters_consumed, 2),
        "surcharge_amount": round(surcharge_amount, 2),
        "surcharge_percent": round(surcharge_percent, 2),
        "total_freight_cost": round(total_freight_cost, 2),
    }
