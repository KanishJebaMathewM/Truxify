import asyncio
from io import BytesIO

import pytest
from fastapi import HTTPException, UploadFile

import audio_limits


class BoundedReader:
    def __init__(self, payload):
        self.payload = payload
        self.requested_size = None

    async def read(self, size=-1):
        self.requested_size = size
        return self.payload


def test_rejects_declared_oversized_upload_without_reading(monkeypatch):
    monkeypatch.setattr(audio_limits, "MAX_AUDIO_BYTES", 4)

    reader = BoundedReader(b"never-read")
    reader.size = 5

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(audio_limits.read_limited_audio(reader))

    assert exc_info.value.status_code == 413
    assert reader.requested_size is None


def test_reads_only_one_byte_beyond_configured_limit(monkeypatch):
    monkeypatch.setattr(audio_limits, "MAX_AUDIO_BYTES", 4)

    reader = BoundedReader(b"12345")

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(audio_limits.read_limited_audio(reader))

    assert exc_info.value.status_code == 413
    assert reader.requested_size == 5


def test_accepts_audio_at_exact_limit(monkeypatch):
    monkeypatch.setattr(audio_limits, "MAX_AUDIO_BYTES", 4)

    reader = BoundedReader(b"1234")

    result = asyncio.run(audio_limits.read_limited_audio(reader))

    assert result == b"1234"
    assert reader.requested_size == 5


def test_rejects_empty_audio(monkeypatch):
    monkeypatch.setattr(audio_limits, "MAX_AUDIO_BYTES", 4)

    upload = UploadFile(filename="empty.wav", file=BytesIO(b""))

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(audio_limits.read_limited_audio(upload))

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Audio file cannot be empty"


def test_rejects_oversized_upload_reported_by_upload_file_size(monkeypatch):
    monkeypatch.setattr(audio_limits, "MAX_AUDIO_BYTES", 4)

    upload = UploadFile(filename="large.wav", file=BytesIO(b"123456"))
    upload.size = 6

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(audio_limits.read_limited_audio(upload))

    assert exc_info.value.status_code == 413
