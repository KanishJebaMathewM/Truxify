from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import Optional

router = APIRouter(prefix="/ml", tags=["Toll vs Detour Economic Tradeoff"])


class TollTradeoffRequest(BaseModel):
    toll_route_distance_km: float = Field(..., gt=0.0)
    toll_fee_amount: float = Field(..., ge=0.0)
    detour_route_distance_km: float = Field(..., gt=0.0)
    detour_extra_time_minutes: float = Field(..., ge=0.0)
    fuel_price_per_liter: Optional[float] = Field(92.50, gt=0.0)
    truck_mileage_km_per_liter: Optional[float] = Field(3.5, gt=0.0)
    driver_hourly_wage: Optional[float] = Field(250.0, ge=0.0)
    depreciation_per_km: Optional[float] = Field(4.0, ge=0.0)


@router.post("/toll-tradeoff")
def analyze_toll_tradeoff(req: TollTradeoffRequest):
    fuel_price = req.fuel_price_per_liter if req.fuel_price_per_liter is not None else 92.50
    mileage = req.truck_mileage_km_per_liter if req.truck_mileage_km_per_liter is not None else 3.5
    wage_hourly = req.driver_hourly_wage if req.driver_hourly_wage is not None else 250.0
    deprec_per_km = req.depreciation_per_km if req.depreciation_per_km is not None else 4.0

    extra_km = max(0.0, req.detour_route_distance_km - req.toll_route_distance_km)
    extra_fuel_liters = extra_km / mileage
    extra_fuel_cost = extra_fuel_liters * fuel_price

    extra_driver_cost = (req.detour_extra_time_minutes / 60.0) * wage_hourly
    extra_wear_cost = extra_km * deprec_per_km

    total_detour_cost = extra_fuel_cost + extra_driver_cost + extra_wear_cost
    net_savings_from_detour = req.toll_fee_amount - total_detour_cost

    recommendation = "AVOID_TOLL" if net_savings_from_detour > 0 else "PAY_TOLL"

    return {
        "success": True,
        "recommendation": recommendation,
        "toll_fee": round(req.toll_fee_amount, 2),
        "extra_distance_km": round(extra_km, 2),
        "detour_fuel_cost": round(extra_fuel_cost, 2),
        "detour_driver_cost": round(extra_driver_cost, 2),
        "detour_wear_cost": round(extra_wear_cost, 2),
        "total_detour_cost": round(total_detour_cost, 2),
        "net_benefit_amount": round(abs(net_savings_from_detour), 2),
        "should_take_detour": net_savings_from_detour > 0,
    }
