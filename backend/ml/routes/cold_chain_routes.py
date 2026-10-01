from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from services.cold_chain_anomaly import (
    calculate_mean_kinetic_temperature,
    evaluate_cargo_integrity,
    evaluate_shock_vibration,
)

router = APIRouter(prefix="/coldchain", tags=["Cold-Chain & Cargo Integrity"])


class TelemetryEvaluationRequest(BaseModel):
    load_id: str
    booking_id: Optional[str] = None
    temperatures_celsius: List[float] = Field(..., description="List of temperature readings in Celsius")
    min_temp_celsius: float = Field(2.0, description="Minimum allowable temperature in Celsius")
    max_temp_celsius: float = Field(8.0, description="Maximum allowable temperature in Celsius")
    shock_readings_g: Optional[List[float]] = Field(default=None, description="Tri-axial shock readings in g-force")
    door_open_events: Optional[int] = Field(default=0, description="Count of door open sensor triggers")
    max_allowed_excursion_mins: Optional[int] = Field(default=45, description="Max allowed excursion minutes")
    sample_interval_mins: Optional[float] = Field(default=1.0, description="Sample frequency in minutes")


class MktRequest(BaseModel):
    temperatures_celsius: List[float]


@router.post("/evaluate")
async def evaluate_telemetry(payload: TelemetryEvaluationRequest) -> Dict[str, Any]:
    """
    Evaluates IoT telemetry window for thermal degradation, shock impacts, and SLA breach status.
    """
    try:
        results = evaluate_cargo_integrity(
            temperatures_celsius=payload.temperatures_celsius,
            min_temp=payload.min_temp_celsius,
            max_temp=payload.max_temp_celsius,
            shock_readings_g=payload.shock_readings_g,
            door_open_events=payload.door_open_events or 0,
            max_allowed_excursion_mins=payload.max_allowed_excursion_mins or 45,
            sample_interval_mins=payload.sample_interval_mins or 1.0,
        )
        return {
            "success": True,
            "load_id": payload.load_id,
            "booking_id": payload.booking_id,
            "data": results,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/mkt")
async def compute_mkt(payload: MktRequest) -> Dict[str, Any]:
    """
    Calculates Mean Kinetic Temperature (MKT) for a given series of Celsius readings.
    """
    try:
        mkt = calculate_mean_kinetic_temperature(payload.temperatures_celsius)
        return {
            "success": True,
            "mkt_celsius": mkt,
            "sample_count": len(payload.temperatures_celsius),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
