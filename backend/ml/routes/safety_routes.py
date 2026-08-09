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

# Upload hardening: never read more than this many bytes from a client upload,
# and only accept known media types for each analysis endpoint.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
_UPLOAD_CHUNK_BYTES = 64 * 1024
_ALLOWED_VISION_MIME = {'image/jpeg', 'image/png', 'image/webp', 'image/bmp'}
_ALLOWED_AUDIO_MIME = {
    'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/flac', 'audio/ogg',
    'audio/oga', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a',
}

# Shared Redis client initialized once at module level
_redis_url = os.environ.get('REDIS_URL', 'redis://localhost:6379')
redis_client = redis.Redis.from_url(_redis_url, decode_responses=True)


def _validate_content_length(content_length):
    if content_length is not None:
        try:
            content_length = int(content_length)
        except (TypeError, ValueError):
            content_length = None
        if content_length is not None and content_length > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f'Upload too large: maximum allowed size is {MAX_UPLOAD_BYTES // (1024 * 1024)} MB',
            )


async def _read_upload(file, allowed_mimes):
    """Validate MIME type and read the upload in bounded chunks.

    Rejects unknown media types with 415 and any upload that exceeds
    ``MAX_UPLOAD_BYTES`` with 413 instead of buffering it into memory.
    """
    if file.content_type not in allowed_mimes:
        raise HTTPException(
            status_code=415,
            detail=f'Unsupported media type: {file.content_type or "unknown"}',
        )
    _validate_content_length(file.headers.get('content-length'))
    contents = bytearray()
    while True:
        chunk = await file.read(_UPLOAD_CHUNK_BYTES)
        if not chunk:
            break
        contents.extend(chunk)
        if len(contents) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f'Upload too large: maximum allowed size is {MAX_UPLOAD_BYTES // (1024 * 1024)} MB',
            )
    return bytes(contents)

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
        # Read image (bounded, MIME-checked)
        contents = await _read_upload(file, _ALLOWED_VISION_MIME)
        nparr = np.frombuffer(contents, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        # Process frame
        result = vision_monitor.process_frame(frame)
        
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Vision analysis failed: {e}")
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/audio/analyze")
async def analyze_audio(file: UploadFile = File(...)):
    """Analyze driver audio"""
    try:
        # Read audio (bounded, MIME-checked)
        contents = await _read_upload(file, _ALLOWED_AUDIO_MIME)
        audio_data, sr = sf.read(io.BytesIO(contents))
        
        # Process audio
        result = audio_monitor.process_audio(audio_data)
        
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Audio analysis failed: {e}")
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

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
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

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
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

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
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

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
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

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
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

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
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

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
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")