from typing import Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel


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

    # TODO:
    # Send audio_data to Bhashini / Whisper Indic ASR.
    #
    # Example expected result:
    # transcript = "Mera agla load kahan se uthana hai?"
    # language = "hi"

    transcript = ""
    language = "auto"

    return VoiceQueryResponse(
        success=True,
        transcript=transcript,
        language=language,
        intent="unknown",
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

    # Basic intent detection placeholder.
    #
    # These will later be replaced with an LLM-based
    # intent + slot extraction service.

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

    TODO:
    Integrate Coqui / ElevenLabs regional TTS here.
    """

    text = request.text.strip()

    if not text:
        raise HTTPException(
            status_code=400,
            detail="Text cannot be empty.",
        )

    return {
        "success": True,
        "language": request.language or "auto",
        "text": text,
        "audio_url": None,
        "message": "TTS integration pending.",
    }
