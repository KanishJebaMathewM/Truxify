import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.models.ocr_verifier import ocr_verifier
from main import app

client = TestClient(app, headers={"X-API-Key": "test_key"})


class TestVerifyLicense:
    def test_none_text_is_unverified(self):
        result = ocr_verifier.verify_license(None)
        assert result["verified"] is False
        assert result["extracted_number"] is None

    def test_empty_text_is_unverified(self):
        result = ocr_verifier.verify_license("")
        assert result["verified"] is False
        assert result["extracted_number"] is None

    def test_simulated_marker_without_licence_is_rejected(self):
        # A simulated/forged marker that is NOT a valid DL format must never pass.
        result = ocr_verifier.verify_license("SIMULATED_DL_NUMBER")
        assert result["verified"] is False
        assert result["extracted_number"] is None

    def test_valid_dl_pattern_is_verified(self):
        result = ocr_verifier.verify_license("My licence number is DL-1420110012345")
        assert result["verified"] is True
        assert result["extracted_number"] == "DL-1420110012345"

    def test_valid_dl_pattern_compact_is_verified(self):
        result = ocr_verifier.verify_license("Licence DL1420110012345 here")
        assert result["verified"] is True
        assert result["extracted_number"] == "DL1420110012345"

    def test_unrecognised_text_is_unverified(self):
        result = ocr_verifier.verify_license("some random text without a licence")
        assert result["verified"] is False
        assert result["extracted_number"] is None


class TestExtractText:
    def test_garbage_bytes_return_none(self):
        # OCR failure must surface as None, never a fabricated licence number.
        assert ocr_verifier.extract_text(b"definitely not an image") is None


class TestVerifyKycEndpoint:
    def test_rejects_non_image_content_type(self):
        res = client.post(
            "/verify/kyc",
            files={"file": ("doc.txt", b"hello", "text/plain")},
        )
        assert res.status_code == 422
        assert "Unsupported file type" in res.json()["detail"]

    def test_rejects_empty_file(self):
        res = client.post(
            "/verify/kyc",
            files={"file": ("img.png", b"", "image/png")},
        )
        assert res.status_code == 422
        assert res.json()["detail"] == "Uploaded file is empty."

    def test_unreadable_image_returns_unverified(self):
        # Corrupt image bytes make extract_text return None; the endpoint must
        # report unverified instead of falling back to a simulated licence.
        res = client.post(
            "/verify/kyc",
            files={"file": ("img.png", b"\x89PNG\r\n\x1a\n not-a-real-png", "image/png")},
        )
        assert res.status_code == 200
        body = res.json()
        assert body["verified"] is False
        assert body["document_type"] == "Unknown"
        assert body["extracted_number"] is None

    def test_requires_api_key(self):
        res = client.post(
            "/verify/kyc",
            files={"file": ("img.png", b"\x89PNG\r\n\x1a\n not-a-real-png", "image/png")},
            headers={"X-API-Key": "wrong-key"},
        )
        assert res.status_code == 401
