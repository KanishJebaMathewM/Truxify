import io
import json
import logging
import os
from datetime import datetime

import cv2
import numpy as np
import redis
import soundfile as sf
from fastapi import APIRouter, File, HTTPException, UploadFile
from multimodal.audio_monitor import AudioMonitor
from multimodal.vision_monitor import VisionMonitor
from routes.safety_fusion_routes import router as fusion_router
from routes.safety_fusion_routes import sensor_fusion

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
router.include_router(fusion_router)

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
        result = audio_monitor.process_audio(audio_data, sample_rate=int(sr))
        
        return {
            'success': result.get('status') == 'OK',
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