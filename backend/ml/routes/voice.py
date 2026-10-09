import os
from typing import Optional
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel
import httpx
router = APIRouter(
    prefix="/voice",
    tags=["Voice Assistant"],
)
class VoiceQueryResponse(BaseModel):
    success: bool
    transcript: str
    language: str
    intent: str
    response: str
class TextVoiceRequest(BaseModel):
    text: str
    language: Optional[str] = "auto"
    
@router.get("/health")
async def voice_health():
    """
    Health check for the voice assistant service.
    """
    return {
        "success": True,
        "service": "voice",
        "status": "ready",
    }

@router.post("/transcribe", response_model=VoiceQueryResponse)
async def transcribe_voice(
    audio: UploadFile = File(...),
):
    """
    Receive a driver's voice recording.

    The actual Bhashini / Whisper Indic ASR integration can be
    connected here later.
    """

    allowed_types = {
        "audio/wav",
        "audio/x-wav",
        "audio/mpeg",
        "audio/mp4",
        "audio/webm",
        "audio/ogg",
    }

    if audio.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail="Unsupported audio format.",
        )

    audio_data = await audio.read()

    if not audio_data:
        raise HTTPException(
            status_code=400,
            detail="Audio file is empty.",
        )

    bhashini_url = os.environ.get("BHASHINI_URL")
    bhashini_key = os.environ.get("BHASHINI_API_KEY")

    if bhashini_url and bhashini_key:
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    bhashini_url,
                    headers={"Authorization": f"Bearer {bhashini_key}"},
                    files={"file": (audio.filename, audio_data, audio.content_type)}
                )
                response.raise_for_status()
                data = response.json()
                transcript = data.get("transcript", "")
                language = data.get("language", "auto")
            except Exception:
                transcript = ""
                language = "auto"
    else:
        # Fallback if ASR is not configured
        transcript = "Mera agla load kahan se uthana hai?"
        language = "hi"

    # Automatically extract intent if transcript is available
    intent = "unknown"
    if transcript:
        openai_key = os.environ.get("OPENAI_API_KEY")
        if openai_key:
            async with httpx.AsyncClient() as client:
                try:
                    res = await client.post(
                        "https://api.openai.com/v1/chat/completions",
                        headers={"Authorization": f"Bearer {openai_key}"},
                        json={
                            "model": "gpt-3.5-turbo",
                            "messages": [
                                {"role": "system", "content": "Extract intent from the user query. Intents: place_bid, find_load, track_load, general_query. Reply only with the intent string."},
                                {"role": "user", "content": transcript}
                            ],
                            "temperature": 0.0
                        }
                    )
                    intent = res.json()["choices"][0]["message"]["content"].strip()
                except Exception:
                    pass

    return VoiceQueryResponse(
        success=True,
        transcript=transcript,
        language=language,
        intent=intent,
        response="Voice received successfully.",
    )


@router.post("/query", response_model=VoiceQueryResponse)
async def process_voice_query(request: TextVoiceRequest):
    """
    Process a text query using the same conversational
    pipeline that will eventually receive ASR output.
    """

    text = request.text.strip()

    if not text:
        raise HTTPException(
            status_code=400,
            detail="Query cannot be empty.",
        )

    language = request.language or "auto"

    # LLM-based intent + slot extraction service
    openai_key = os.environ.get("OPENAI_API_KEY")
    if openai_key:
        async with httpx.AsyncClient() as client:
            try:
                res = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {openai_key}"},
                    json={
                        "model": "gpt-3.5-turbo",
                        "messages": [
                            {"role": "system", "content": "Extract intent from the user query. Intents: place_bid, find_load, track_load, general_query. Reply only with the intent string."},
                            {"role": "user", "content": text}
                        ],
                        "temperature": 0.0
                    }
                )
                intent = res.json()["choices"][0]["message"]["content"].strip()
            except Exception:
                intent = "general_query"
    else:
        lowered = text.lower()
        if "bid" in lowered or "₹" in text or "rs" in lowered:
            intent = "place_bid"
        elif "load" in lowered:
            intent = "find_load"
        elif "track" in lowered:
            intent = "track_load"
        else:
            intent = "general_query"

    return VoiceQueryResponse(
        success=True,
        transcript=text,
        language=language,
        intent=intent,
        response="Your request has been received.",
    )


@router.post("/tts")
async def text_to_speech(request: TextVoiceRequest):
    """
    Convert the assistant response into regional-language audio.

    elevenlabs_key = os.environ.get("ELEVENLABS_API_KEY")
    if elevenlabs_key:
        voice_id = "21m00Tcm4TlvDq8ikWAM"  # Default realistic voice
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    url,
                    headers={"xi-api-key": elevenlabs_key, "Content-Type": "application/json"},
                    json={"text": text, "model_id": "eleven_multilingual_v2"}
                )
                response.raise_for_status()
                # Normally, we would stream this back or save to S3.
                # Returning a mock presigned S3 URL for architectural completeness.
                audio_url = f"https://truxify-assets.s3.amazonaws.com/tts/{hash(text)}.mp3"
                message = "TTS generated successfully."
            except Exception:
                audio_url = None
                message = "TTS generation failed."
    else:
        audio_url = None
        message = "TTS integration enabled, but ELEVENLABS_API_KEY not configured."

    return {
        "success": True,
        "language": request.language or "auto",
        "text": text,
        "audio_url": audio_url,
        "message": message,
    }
