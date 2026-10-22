# ml-service/app.py (Excerpt)
from pydantic import BaseModel

class CancellationPenaltyRequest(BaseModel):
    distance_covered_km: float
    total_distance_km: float
    fare_amount: float

@app.post("/ml/cancellation-penalty")
def calculate_cancellation_penalty(data: CancellationPenaltyRequest):
    if data.total_distance_km <= 0:
        ratio = 0.0
    else:
        ratio = min(1.0, max(0.0, data.distance_covered_km / data.total_distance_km))
    
    # Proportional penalty calculation (base fee + distance compensation)
    base_penalty = data.fare_amount * 0.10
    distance_penalty = data.fare_amount * 0.40 * ratio
    total_penalty = round(base_penalty + distance_penalty, 2)
    
    return {
        "success": True,
        "distance_covered_ratio": round(ratio, 4),
        "penalty_amount": total_penalty,
        "refund_amount": round(data.fare_amount - total_penalty, 2)
    }
