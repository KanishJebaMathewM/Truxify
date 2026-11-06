from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import List, Optional

router = APIRouter(prefix="/ml", tags=["Hours of Service Compliance"])

RULES = {
    "morth": {
        "max_continuous_driving_hours": 4.5,
        "mandatory_break_minutes": 30,
        "max_daily_driving_hours": 8.0,
    },
    "fmcsa": {
        "max_continuous_driving_hours": 8.0,
        "mandatory_break_minutes": 30,
        "max_daily_driving_hours": 11.0,
    },
}


class HOSScheduleRequest(BaseModel):
    current_continuous_driving_hours: float = Field(0.0, ge=0.0)
    current_shift_driving_hours: float = Field(0.0, ge=0.0)
    planned_trip_hours: float = Field(..., gt=0.0)
    regulation_standard: Optional[str] = Field("morth", description="'morth' (India) or 'fmcsa' (US)")


@router.post("/hos-schedule")
def generate_hos_schedule(req: HOSScheduleRequest):
    std = (req.regulation_standard or "morth").lower()
    rule = RULES.get(std, RULES["morth"])
    max_continuous = rule["max_continuous_driving_hours"]
    break_mins = rule["mandatory_break_minutes"]
    max_daily = rule["max_daily_driving_hours"]

    remaining_daily_drive = max(0.0, max_daily - req.current_shift_driving_hours)
    can_complete_shift = req.planned_trip_hours <= remaining_daily_drive

    scheduled_breaks = []
    accumulated_continuous = req.current_continuous_driving_hours
    accumulated_trip = 0.0

    while accumulated_trip < req.planned_trip_hours:
        drive_until_break = max_continuous - accumulated_continuous
        if drive_until_break <= 0:
            accumulated_continuous = 0.0
            drive_until_break = max_continuous

        if accumulated_trip + drive_until_break < req.planned_trip_hours:
            accumulated_trip += drive_until_break
            scheduled_breaks.append({
                "trip_offset_hours": round(accumulated_trip, 2),
                "break_duration_minutes": break_mins,
                "reason": f"Mandatory {break_mins}-minute rest break after {max_continuous}h driving limit",
            })
            accumulated_continuous = 0.0
        else:
            break

    total_trip_duration_with_breaks = req.planned_trip_hours + (len(scheduled_breaks) * (break_mins / 60.0))

    return {
        "success": True,
        "regulation_standard": std,
        "can_complete_within_legal_shift": can_complete_shift,
        "remaining_legal_driving_hours": round(remaining_daily_drive, 2),
        "scheduled_breaks_count": len(scheduled_breaks),
        "scheduled_breaks": scheduled_breaks,
        "total_elapsed_hours": round(total_trip_duration_with_breaks, 2),
        "shift_violation_risk": not can_complete_shift,
    }
