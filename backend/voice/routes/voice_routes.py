from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from typing import Optional, Dict
import json
import base64
from datetime import datetime
from services.voice_ai_service import VoiceAIService

router = APIRouter(prefix="/voice", tags=["Voice AI"])

# Initialize Voice AI Service
voice_service = VoiceAIService()

class VoiceRequest(BaseModel):
    audio_data: Optional[str] = None  # Base64 encoded
    language_code: Optional[str] = None
    user_id: str

class VoiceResponse(BaseModel):
    success: bool
    detected_language: Optional[Dict] = None
    transcription: Optional[Dict] = None
    intent: Optional[Dict] = None
    response_text: Optional[str] = None
    response_audio: Optional[str] = None
    error: Optional[str] = None
    timestamp: str

@router.post("/process", response_model=VoiceResponse)
async def process_voice(
    audio: Optional[UploadFile] = File(None),
    user_id: str = Form(...),
    language_code: Optional[str] = Form(None)
):
    """Process voice command with language detection"""
    try:
        # Read audio
        if audio:
            audio_data = await audio.read()
        else:
            raise HTTPException(status_code=400, detail="Audio data required")
        
        # Process command
        result = await voice_service.process_voice_command(audio_data, user_id)
        
        return VoiceResponse(
            success=result.get('success', False),
            detected_language=result.get('detected_language'),
            transcription=result.get('transcription'),
            intent=result.get('intent'),
            response_text=result.get('response_text'),
            response_audio=result.get('response_audio'),
            error=result.get('error'),
            timestamp=result.get('timestamp', datetime.now().isoformat())
        )
        
    except Exception as e:
        return VoiceResponse(
            success=False,
            error=str(e),
            timestamp=datetime.now().isoformat()
        )

@router.post("/detect-language")
async def detect_language(audio: UploadFile = File(...)):
    """Detect language from audio"""
    try:
        audio_data = await audio.read()
        result = await voice_service.detect_language(audio_data)
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }

@router.post("/transcribe")
async def transcribe_speech(
    audio: UploadFile = File(...),
    language_code: Optional[str] = Form(None)
):
    """Transcribe speech with dialect support"""
    try:
        audio_data = await audio.read()
        result = await voice_service.transcribe_speech(audio_data, language_code)
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }

@router.post("/synthesize")
async def synthesize_speech(
    text: str = Form(...),
    language_code: str = Form('hi')
):
    """Generate speech from text"""
    try:
        audio = await voice_service.generate_speech(text, language_code)
        audio_base64 = base64.b64encode(audio).decode('utf-8')
        return {
            'success': True,
            'audio': audio_base64,
            'format': 'mp3',
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }

@router.get("/languages")
async def get_supported_languages():
    """Get list of supported languages"""
    return {
        'success': True,
        'data': voice_service.get_supported_languages(),
        'timestamp': datetime.now().isoformat()
    }

@router.get("/stats")
async def get_language_stats():
    """Get language usage statistics"""
    stats = await voice_service.get_language_stats()
    return {
        'success': True,
        'data': stats,
        'timestamp': datetime.now().isoformat()
    }

@router.get("/dialects/{language_code}")
async def get_dialects(language_code: str):
    """Get dialects for a specific language"""
    language = voice_service.languages.get(language_code)
    if not language:
        raise HTTPException(status_code=404, detail="Language not supported")
    
    return {
        'success': True,
        'data': {
            'language_code': language_code,
            'language_name': language['name'],
            'dialects': language['dialects']
        },
        'timestamp': datetime.now().isoformat()
    }

@router.post("/translate")
async def translate_text(
    text: str = Form(...),
    source_lang: str = Form('hi'),
    target_lang: str = Form('en')
):
    """Translate text between languages"""
    try:
        translated = voice_service.translator.translate(text, src=source_lang, dest=target_lang)
        return {
            'success': True,
            'data': {
                'original': text,
                'translated': translated.text,
                'source_lang': source_lang,
                'target_lang': target_lang,
                'confidence': translated.origin
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }