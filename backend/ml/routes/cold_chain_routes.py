from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, StrictFloat, StrictInt
from services.cold_chain_anomaly import (
    calculate_mean_kinetic_temperature,
    evaluate_cargo_integrity,
)

router = APIRouter(prefix="/coldchain", tags=["Cold-Chain & Cargo Integrity"])


class TelemetryEvaluationRequest(BaseModel):
    load_id: str
    booking_id: str | None = None
    temperatures_celsius: list[StrictFloat] = Field(
        ..., description="List of temperature readings in Celsius"
    )
    min_temp_celsius: StrictFloat = Field(
        2.0, description="Minimum allowable temperature in Celsius"
    )
    max_temp_celsius: StrictFloat = Field(
        8.0, description="Maximum allowable temperature in Celsius"
    )
    shock_readings_g: list[StrictFloat] | None = Field(
        default=None, description="Tri-axial shock readings in g-force"
    )
    door_open_events: StrictInt | None = Field(
        default=0, description="Count of door open sensor triggers"
    )
    max_allowed_excursion_mins: StrictInt | None = Field(
        default=45, description="Max allowed excursion minutes"
    )
    sample_interval_mins: StrictFloat | None = Field(
        default=1.0, description="Sample frequency in minutes"
    )


class MktRequest(BaseModel):
    temperatures_celsius: list[StrictFloat]


@router.post("/evaluate")
async def evaluate_telemetry(payload: TelemetryEvaluationRequest) -> dict[str, Any]:
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
            max_allowed_excursion_mins=45
            if payload.max_allowed_excursion_mins is None
            else payload.max_allowed_excursion_mins,
            sample_interval_mins=1.0
            if payload.sample_interval_mins is None
            else payload.sample_interval_mins,
        )
        return {
            "success": True,
            "load_id": payload.load_id,
            "booking_id": payload.booking_id,
            "data": results,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail="Cold-chain evaluation failed"
        ) from exc


@router.post("/mkt")
async def compute_mkt(payload: MktRequest) -> dict[str, Any]:
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
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail="Cold-chain evaluation failed"
        ) from exc
