"""Fusion HTTP contract independent of camera/audio device initialization."""

import os
from datetime import datetime

from fastapi import APIRouter
from multimodal.sensor_fusion import SensorFusion
from pydantic import BaseModel

router = APIRouter(prefix="/fusion")
sensor_fusion = SensorFusion(os.environ.get("REDIS_URL", "redis://localhost:6379"))


class SafetyAlertResponse(BaseModel):
    alert_level: str
    alert_message: str
    fusion_risk: float
    actions: list
    timestamp: str
    data_available: bool
    coverage_complete: bool
    availability: dict
    persistence_available: bool


@router.post("/analyze")
async def analyze_safety(
    vision_data: dict | None = None,
    audio_data: dict | None = None,
    sensor_data: dict | None = None,
):
    result = sensor_fusion.analyze(vision_data, audio_data, sensor_data)
    return {
        "success": True,
        "data": result,
        "timestamp": datetime.now().astimezone().isoformat(),
    }


@router.get("/report", response_model=SafetyAlertResponse)
async def get_safety_report():
    return SafetyAlertResponse(**sensor_fusion.get_safety_report())
