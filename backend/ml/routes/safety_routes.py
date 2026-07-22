import os
from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Dict, Any, Optional
import json
import base64
import numpy as np
import cv2
import soundfile as sf
import io
from datetime import datetime
import logging
import redis

from multimodal.vision_monitor import VisionMonitor
from multimodal.audio_monitor import AudioMonitor
from multimodal.sensor_fusion import SensorFusion

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/safety", tags=["Driver Safety"])

# Shared Redis client initialized once at module level
_redis_url = os.environ.get('REDIS_URL', 'redis://localhost:6379')
redis_client = redis.Redis.from_url(_redis_url, decode_responses=True)

# Initialize monitors
vision_monitor = VisionMonitor()
audio_monitor = AudioMonitor()
sensor_fusion = SensorFusion()

class SafetyAlertResponse(BaseModel):
    alert_level: str
    alert_message: str
    fusion_risk: float
    actions: list
    timestamp: str

@router.post("/vision/analyze")
async def analyze_vision_frame(file: UploadFile = File(...)):
    """Analyze driver vision frame"""
    try:
        # Read image
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        # Process frame
        result = vision_monitor.process_frame(frame)
        
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Vision analysis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/audio/analyze")
async def analyze_audio(file: UploadFile = File(...)):
    """Analyze driver audio"""
    try:
        # Read audio
        contents = await file.read()
        audio_data, sr = sf.read(io.BytesIO(contents))
        
        # Process audio
        result = audio_monitor.process_audio(audio_data)
        
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Audio analysis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/audio/record")
async def record_audio(duration: int = 2):
    """Record and analyze audio"""
    try:
        # Record audio
        audio_data = audio_monitor.record_audio(duration)
        
        # Process
        result = audio_monitor.process_audio(audio_data)
        
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Audio recording failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/fusion/analyze")
async def analyze_safety(
    vision_data: Optional[Dict] = None,
    audio_data: Optional[Dict] = None,
    sensor_data: Optional[Dict] = None
):
    """Analyze safety using all modalities"""
    try:
        # If no data provided, get latest
        if vision_data is None:
            vision_data = json.loads(vision_monitor.redis.get('vision:latest') or '{}')
        if audio_data is None:
            audio_data = json.loads(audio_monitor.redis.get('audio:latest') or '{}')
        if sensor_data is None:
            sensor_data = {}
        
        # Fuse data
        result = sensor_fusion.fuse_data(vision_data, audio_data, sensor_data)
        
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Safety analysis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/fusion/report", response_model=SafetyAlertResponse)
async def get_safety_report():
    """Get latest safety report"""
    try:
        report = sensor_fusion.get_safety_report()
        return SafetyAlertResponse(
            alert_level=report['alert_level'],
            alert_message=report['alert_message'],
            fusion_risk=report['fusion_risk'],
            actions=report.get('actions', []),
            timestamp=report['timestamp']
        )
    except Exception as e:
        logger.error(f"Safety report failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/vision/status")
async def get_vision_status():
    """Get latest vision monitoring status"""
    try:
        data = vision_monitor.redis.get('vision:latest')
        if data:
            return {
                'success': True,
                'data': json.loads(data),
                'timestamp': datetime.now().isoformat()
            }
        return {
            'success': True,
            'data': None,
            'message': 'No vision data available'
        }
    except Exception as e:
        logger.error(f"Vision status failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/audio/status")
async def get_audio_status():
    """Get latest audio monitoring status"""
    try:
        data = audio_monitor.redis.get('audio:latest')
        if data:
            return {
                'success': True,
                'data': json.loads(data),
                'timestamp': datetime.now().isoformat()
            }
        return {
            'success': True,
            'data': None,
            'message': 'No audio data available'
        }
    except Exception as e:
        logger.error(f"Audio status failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/fusion/stats")
async def get_fusion_stats():
    """Get sensor fusion statistics"""
    try:
        stats = sensor_fusion.get_stats()
        return {
            'success': True,
            'data': stats,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Fusion stats failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/alert/trigger")
async def trigger_alert(level: str = "WARNING"):
    """Manually trigger safety alert"""
    try:
        alert = {
            'level': level,
            'message': f'Manual {level} alert triggered',
            'actions': ['Investigate cause', 'Review footage', 'Log incident'],
            'timestamp': datetime.now().isoformat()
        }
        
        # Store alert using shared Redis client
        redis_client.setex('safety:alert:latest', 300, json.dumps(alert))
        
        return {
            'success': True,
            'data': alert,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Alert trigger failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))