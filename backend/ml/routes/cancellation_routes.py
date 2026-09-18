from fastapi import APIRouter
from pydantic import BaseModel, Field, FiniteFloat

router = APIRouter(prefix="/cancellation-penalty", tags=["Cancellation Penalty"])


class CancellationPenaltyRequest(BaseModel):
    distance_covered_km: FiniteFloat = Field(..., ge=0)
    total_distance_km: FiniteFloat = Field(..., gt=0)
    total_amount: FiniteFloat = Field(..., ge=0, description="Booking amount in the supplied currency")


class CancellationPenaltyResponse(BaseModel):
    distance_covered_km: float
    total_distance_km: float
    covered_ratio: float
    penalty_amount: float


@router.post("", response_model=CancellationPenaltyResponse)
async def calculate_cancellation_penalty(request: CancellationPenaltyRequest):
    """Calculate the proportional amount retained after a mid-trip cancellation."""
    covered_ratio = min(request.distance_covered_km / request.total_distance_km, 1.0)
    penalty_amount = round(request.total_amount * covered_ratio, 2)
    return CancellationPenaltyResponse(
        distance_covered_km=request.distance_covered_km,
        total_distance_km=request.total_distance_km,
        covered_ratio=round(covered_ratio, 6),
        penalty_amount=penalty_amount,
    )
