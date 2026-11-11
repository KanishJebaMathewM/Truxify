from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import List

router = APIRouter(prefix="/ml", tags=["Capacity & Payload Optimization"])


class CargoItem(BaseModel):
    item_id: str
    weight_kg: float = Field(..., gt=0)
    volume_m3: float = Field(..., gt=0)
    revenue: float = Field(..., ge=0)


class OptimizePayloadRequest(BaseModel):
    max_weight_kg: float = Field(..., gt=0)
    max_volume_m3: float = Field(..., gt=0)
    items: List[CargoItem]


@router.post("/optimize-payload")
def optimize_payload(req: OptimizePayloadRequest):
    if not req.items:
        return {
            "success": True,
            "selected_items": [],
            "total_weight_kg": 0.0,
            "total_volume_m3": 0.0,
            "total_revenue": 0.0,
            "weight_utilization_percent": 0.0,
            "volume_utilization_percent": 0.0,
        }

    # Greedy heuristic based on composite density value: revenue / (normalized_weight + normalized_volume)
    scored_items = []
    for item in req.items:
        norm_w = item.weight_kg / req.max_weight_kg
        norm_v = item.volume_m3 / req.max_volume_m3
        density = item.revenue / (norm_w + norm_v) if (norm_w + norm_v) > 0 else 0
        scored_items.append((density, item))

    # Sort descending by density score
    scored_items.sort(key=lambda x: x[0], reverse=True)

    selected = []
    curr_weight = 0.0
    curr_volume = 0.0
    curr_revenue = 0.0

    for _, item in scored_items:
        if curr_weight + item.weight_kg <= req.max_weight_kg and curr_volume + item.volume_m3 <= req.max_volume_m3:
            selected.append(item.model_dump() if hasattr(item, "model_dump") else item.dict())
            curr_weight += item.weight_kg
            curr_volume += item.volume_m3
            curr_revenue += item.revenue

    w_util = round((curr_weight / req.max_weight_kg) * 100.0, 2)
    v_util = round((curr_volume / req.max_volume_m3) * 100.0, 2)

    return {
        "success": True,
        "selected_items": selected,
        "total_weight_kg": round(curr_weight, 2),
        "total_volume_m3": round(curr_volume, 2),
        "total_revenue": round(curr_revenue, 2),
        "weight_utilization_percent": w_util,
        "volume_utilization_percent": v_util,
    }
