import hmac
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
import numpy as np

from services.traffic_pipeline import TrafficPipeline

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/eta", tags=["ETA Predictions"])

db_url = os.getenv('DATABASE_URL', 'sqlite:///./traffic.db')
redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379')
traffic_pipeline = TrafficPipeline(db_url, redis_url)


async def verify_api_key(x_api_key: str = Header(None, alias="X-API-Key")):
    ml_api_key = os.environ.get("ML_API_KEY")
    if not ml_api_key:
        logger.warning("ML_API_KEY not set - ML engine is unavailable (503)")
        raise HTTPException(status_code=503, detail="ML engine not configured: missing ML_API_KEY")
    if not x_api_key or not hmac.compare_digest(x_api_key, ml_api_key):
        raise HTTPException(status_code=401, detail="Unauthorized")


class ETARequest(BaseModel):
    order_id: str
    source_lat: float
    source_lng: float
    dest_lat: float
    dest_lng: float


class ETAUpdateRequest(BaseModel):
    current_lat: float = Field(..., ge=-90, le=90, description="Current location latitude")
    current_lng: float = Field(..., ge=-180, le=180, description="Current location longitude")
    dest_lat: float = Field(..., ge=-90, le=90, description="Destination latitude")
    dest_lng: float = Field(..., ge=-180, le=180, description="Destination longitude")


class ETAResponse(BaseModel):
    order_id: str
    eta_seconds: Optional[float] = None
    eta_minutes: Optional[float] = None
    eta_string: Optional[str] = None
    traffic_speed: Optional[float] = None
    congestion_level: Optional[float] = None
    timestamp: str


def _order_is_assigned(order_id: str) -> bool:
    """Return True only if the order exists and is assigned to a driver."""
    try:
        from app.models.database import SessionLocal
        db = SessionLocal()
        try:
            result = db.execute(
                text(
                    "SELECT 1 FROM orders "
                    "WHERE order_display_id = :oid AND driver_id IS NOT NULL"
                ),
                {"oid": order_id},
            ).scalar()
            return result is not None
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Order verification failed for {order_id}: {e}")
        return False


@router.post("/predict")
async def predict_eta(request: ETARequest, _auth=Depends(verify_api_key)):
    """Predict ETA for a trip"""
    try:
        # Ingest traffic data
        traffic_data = await traffic_pipeline.ingest_traffic_data(
            f"order_{request.order_id}",
            {'lat': request.source_lat, 'lng': request.source_lng},
            {'lat': request.dest_lat, 'lng': request.dest_lng}
        )

        if traffic_data:
            # Use a single UTC-aware datetime so hour, weekday, and response
            # timestamp are all derived from the same instant. datetime.now()
            # (naive local time) can straddle a day boundary between the hour
            # and weekday calls, and produces timezone-dependent features.
            utc_now = datetime.now(timezone.utc)
            features = np.array([[
                traffic_data.traffic_speed,
                traffic_data.free_flow_speed,
                traffic_data.congestion_level,
                utc_now.hour,
                utc_now.weekday()
            ]])

            eta_seconds = traffic_pipeline.predict_eta(features)

            if eta_seconds:
                return ETAResponse(
                    order_id=request.order_id,
                    eta_seconds=eta_seconds,
                    eta_minutes=eta_seconds / 60,
                    eta_string=str(timedelta(seconds=int(eta_seconds))),
                    traffic_speed=traffic_data.traffic_speed,
                    congestion_level=traffic_data.congestion_level,
                    timestamp=utc_now.isoformat()
                )

        raise HTTPException(status_code=500, detail="ETA prediction failed")

    except Exception as e:
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/update/{order_id}")
async def update_eta(order_id: str, request: ETAUpdateRequest, _auth=Depends(verify_api_key)):
    """Update ETA in real-time from real tracking coordinates"""
    if not _order_is_assigned(order_id):
        raise HTTPException(status_code=404, detail="Order not found or not assigned to a driver")

    current_location = {'lat': request.current_lat, 'lng': request.current_lng}
    destination = {'lat': request.dest_lat, 'lng': request.dest_lng}

    result = await traffic_pipeline.update_eta_realtime(
        order_id,
        current_location,
        destination
    )

    if result:
        utc_now = datetime.now(timezone.utc)
        return {
            'order_id': order_id,
            'data': result,
            'timestamp': utc_now.isoformat()
        }

    raise HTTPException(status_code=500, detail="ETA update failed")


@router.get("/traffic/{route_id}")
async def get_traffic(route_id: str, _auth=Depends(verify_api_key)):
    """Get real-time traffic data"""
    try:
        traffic = await traffic_pipeline.get_real_time_traffic(route_id)
        utc_now = datetime.now(timezone.utc)
        if traffic:
            return {
                'route_id': route_id,
                'data': traffic,
                'timestamp': utc_now.isoformat()
            }
        return {
            'route_id': route_id,
            'data': None,
            'message': 'No traffic data available',
            'timestamp': utc_now.isoformat()
        }
    except Exception as e:
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/forecast/{route_id}")
async def get_forecast(route_id: str, hours: int = Query(1, ge=1, le=24), _auth=Depends(verify_api_key)):
    """Get traffic forecast"""
    try:
        forecast = await traffic_pipeline.get_traffic_forecast(route_id, hours)
        utc_now = datetime.now(timezone.utc)
        return {
            'route_id': route_id,
            'data': forecast,
            'timestamp': utc_now.isoformat()
        }
    except Exception as e:
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/train")
async def train_model(_auth=Depends(verify_api_key)):
    """Trigger model retraining"""
    try:
        traffic_pipeline.train_model(epochs=50)
        utc_now = datetime.now(timezone.utc)
        return {
            'status': 'success',
            'message': 'Model trained successfully',
            'timestamp': utc_now.isoformat()
        }
    except Exception as e:
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")
