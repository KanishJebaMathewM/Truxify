from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import Optional

router = APIRouter(prefix="/ml", tags=["Cross-Dock Transfer Estimation"])

# Base handling minutes per unit
PACKAGING_RATES = {
    "palletized": 2.5,
    "bulk_bags": 3.5,
    "loose_cartons": 5.0,
}


class CrossDockRequest(BaseModel):
    unit_count: int = Field(..., gt=0, description="Number of units or pallets to cross-dock")
    packaging_type: str = Field(..., description="Type of packaging: palletized, loose_cartons, or bulk_bags")
    forklifts_available: int = Field(1, ge=1, description="Number of active forklifts assigned")
    congestion_index: Optional[float] = Field(1.0, ge=1.0, le=3.0, description="Dock congestion factor (1.0 to 3.0)")


@router.post("/cross-dock-estimate")
def estimate_cross_dock(req: CrossDockRequest):
    rate = PACKAGING_RATES.get(req.packaging_type.lower(), 3.0)
    congestion = req.congestion_index if req.congestion_index is not None else 1.0

    raw_work_minutes = req.unit_count * rate
    effective_handling_minutes = raw_work_minutes / req.forklifts_available
    total_dwell_minutes = round(effective_handling_minutes * congestion, 1)

    # 15% safety buffer for inspections, paperwork and staging
    safety_buffer_minutes = round(total_dwell_minutes * 0.15, 1)
    recommended_turnaround_minutes = round(total_dwell_minutes + safety_buffer_minutes, 1)

    recommended_labor = max(req.forklifts_available, round(req.unit_count / 30) + 1)

    return {
        "success": True,
        "unit_count": req.unit_count,
        "packaging_type": req.packaging_type,
        "handling_minutes": total_dwell_minutes,
        "safety_buffer_minutes": safety_buffer_minutes,
        "recommended_turnaround_minutes": recommended_turnaround_minutes,
        "recommended_labor_count": recommended_labor,
        "congestion_index": congestion,
    }
