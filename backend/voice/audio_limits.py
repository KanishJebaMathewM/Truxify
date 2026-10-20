import os

from fastapi import HTTPException, UploadFile

DEFAULT_MAX_AUDIO_BYTES = 10 * 1024 * 1024


def _load_max_audio_bytes() -> int:
    raw_value = os.getenv("MAX_AUDIO_BYTES")
    if raw_value is None:
        return DEFAULT_MAX_AUDIO_BYTES

    try:
        value = int(raw_value)
    except ValueError as exc:
        raise RuntimeError("MAX_AUDIO_BYTES must be a positive integer") from exc

    if value <= 0:
        raise RuntimeError("MAX_AUDIO_BYTES must be a positive integer")

    return value


MAX_AUDIO_BYTES = _load_max_audio_bytes()


async def read_limited_audio(audio: UploadFile) -> bytes:
    declared_size = getattr(audio, "size", None)
    if isinstance(declared_size, int) and declared_size > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Audio file exceeds the {MAX_AUDIO_BYTES}-byte limit",
        )

    audio_data = await audio.read(MAX_AUDIO_BYTES + 1)

    if len(audio_data) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Audio file exceeds the {MAX_AUDIO_BYTES}-byte limit",
        )

    if not audio_data:
        raise HTTPException(
            status_code=400,
            detail="Audio file cannot be empty",
        )

    return audio_data
