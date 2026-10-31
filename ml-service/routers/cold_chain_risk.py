from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import Optional

router = APIRouter(prefix="/ml", tags=["Cold-Chain Telemetry & Risk"])


class ColdChainRiskRequest(BaseModel):
    current_temp_celsius: float = Field(..., description="Current measured internal temperature in Celsius")
    target_temp_celsius: float = Field(..., description="Target cargo setpoint in Celsius")
    max_tolerable_temp_celsius: float = Field(..., description="Maximum allowable temperature threshold")
    ambient_temp_celsius: float = Field(..., description="External ambient weather temperature")
    remaining_duration_hours: float = Field(..., gt=0, description="Hours remaining until delivery")
    unit_health_factor: Optional[float] = Field(1.0, ge=0.1, le=1.0, description="Reefer health (0.1 degraded to 1.0 perfect)")


@router.post("/cold-chain-risk")
def predict_cold_chain_risk(req: ColdChainRiskRequest):
    thermal_gradient = max(0.0, req.ambient_temp_celsius - req.current_temp_celsius)
    temp_margin = req.max_tolerable_temp_celsius - req.current_temp_celsius
    unit_health = req.unit_health_factor if req.unit_health_factor is not None else 1.0

    reefer_inefficiency = 1.0 - unit_health
    hourly_drift_rate = max(0.05, (thermal_gradient * 0.08 * reefer_inefficiency) + (0.1 if req.current_temp_celsius > req.target_temp_celsius else 0.0))

    predicted_temp_at_dest = round(req.current_temp_celsius + (hourly_drift_rate * req.remaining_duration_hours), 2)

    if temp_margin <= 0:
        time_to_breach_minutes = 0.0
        excursion_risk = 1.0
        risk_level = "CRITICAL"
    elif predicted_temp_at_dest > req.max_tolerable_temp_celsius:
        hours_to_breach = temp_margin / hourly_drift_rate
        time_to_breach_minutes = round(hours_to_breach * 60.0, 1)
        excursion_risk = min(0.99, round(0.5 + (0.5 * (req.remaining_duration_hours / max(0.1, hours_to_breach))), 2))
        risk_level = "CRITICAL" if hours_to_breach <= 2.0 else "MEDIUM"
    else:
        time_to_breach_minutes = None
        excursion_risk = round(max(0.01, min(0.49, 0.1 * (req.current_temp_celsius - req.target_temp_celsius + 1) / max(1.0, temp_margin))), 2)
        risk_level = "LOW"

    return {
        "success": True,
        "current_temp": req.current_temp_celsius,
        "target_temp": req.target_temp_celsius,
        "predicted_temp_at_destination": predicted_temp_at_dest,
        "excursion_risk_score": excursion_risk,
        "risk_level": risk_level,
        "time_to_breach_minutes": time_to_breach_minutes,
        "requires_immediate_intervention": risk_level == "CRITICAL",
    }
