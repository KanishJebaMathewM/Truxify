from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, Dict, Any
from services.traffic_pipeline import TrafficPipeline
import numpy as np
import os
from datetime import datetime, timedelta

router = APIRouter(prefix="/eta", tags=["ETA Predictions"])

db_url = os.getenv('DATABASE_URL', 'sqlite:///./traffic.db')
redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379')
traffic_pipeline = TrafficPipeline(db_url, redis_url)

class ETARequest(BaseModel):
    order_id: str
    source_lat: float
    source_lng: float
    dest_lat: float
    dest_lng: float

class ETAResponse(BaseModel):
    order_id: str
    eta_seconds: Optional[float] = None
    eta_minutes: Optional[float] = None
    eta_string: Optional[str] = None
    traffic_speed: Optional[float] = None
    congestion_level: Optional[float] = None
    timestamp: str

@router.post("/predict")
async def predict_eta(request: ETARequest):
    """Predict ETA for a trip"""
    try:
        # Ingest traffic data
        traffic_data = await traffic_pipeline.ingest_traffic_data(
            f"order_{request.order_id}",
            {'lat': request.source_lat, 'lng': request.source_lng},
            {'lat': request.dest_lat, 'lng': request.dest_lng}
        )
        
        if traffic_data:
            # Get prediction
            features = np.array([[
                traffic_data.traffic_speed,
                traffic_data.free_flow_speed,
                traffic_data.congestion_level,
                datetime.now().hour,
                datetime.now().weekday()
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
                    timestamp=datetime.now().isoformat()
                )
        
        raise HTTPException(status_code=500, detail="ETA prediction failed")
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/update/{order_id}")
async def update_eta(order_id: str):
    """Update ETA in real-time"""
    try:
        # Get current location from tracking
        # For demo, use simulated location
        current_location = {'lat': 28.6139, 'lng': 77.2090}
        destination = {'lat': 28.7041, 'lng': 77.1025}
        
        result = await traffic_pipeline.update_eta_realtime(
            order_id,
            current_location,
            destination
        )
        
        if result:
            return {
                'order_id': order_id,
                'data': result,
                'timestamp': datetime.now().isoformat()
            }
        
        raise HTTPException(status_code=404, detail="Order not found")
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/traffic/{route_id}")
async def get_traffic(route_id: str):
    """Get real-time traffic data"""
    try:
        traffic = await traffic_pipeline.get_real_time_traffic(route_id)
        if traffic:
            return {
                'route_id': route_id,
                'data': traffic,
                'timestamp': datetime.now().isoformat()
            }
        return {
            'route_id': route_id,
            'data': None,
            'message': 'No traffic data available'
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/forecast/{route_id}")
async def get_forecast(route_id: str, hours: int = Query(1, ge=1, le=24)):
    """Get traffic forecast"""
    try:
        forecast = await traffic_pipeline.get_traffic_forecast(route_id, hours)
        return {
            'route_id': route_id,
            'data': forecast,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/train")
async def train_model():
    """Trigger model retraining"""
    try:
        traffic_pipeline.train_model(epochs=50)
        return {
            'status': 'success',
            'message': 'Model trained successfully',
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))