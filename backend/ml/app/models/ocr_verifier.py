import pytesseract
from PIL import Image
import io
import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)

class OCRVerifier:
    def __init__(self):
        # In a real environment, you might need to set the tesseract_cmd path if it's not in PATH
        # pytesseract.pytesseract.tesseract_cmd = r'/usr/bin/tesseract'
        pass

    def extract_text(self, image_bytes: bytes) -> Optional[str]:
        """
        Extracts text from an image using Tesseract OCR.

        Returns the extracted text, or None if the image cannot be decoded or
        OCR fails. There is deliberately NO simulated fallback: fabricating a
        "SIMULATED_DL_NUMBER" would let a KYC check pass on a licence that was
        never actually read.
        """
        try:
            image = Image.open(io.BytesIO(image_bytes))
            text = pytesseract.image_to_string(image)
            return text
        except Exception as e:
            logger.warning(f"OCR extraction failed: {e}")
            return None

    def verify_license(self, text: Optional[str]) -> dict:
        """
        Searches for a typical Indian Driving License pattern.

        Returns verified: False when no licence number is found (including when
        OCR failed and text is None, or when the input contains a simulated
        DL-... string, which is never accepted).
        """
        if not text:
            return {
                "verified": False,
                "document_type": "Unknown",
                "extracted_number": None,
                "raw_text": ""
            }

        # Common pattern: two letters, two digits, year, followed by 7 digits
        # DL-1420110012345
        dl_pattern = r"([A-Z]{2}[-\s]?\d{2}[-\s]?\d{4}[-\s]?\d{7})"

        dl_match = re.search(dl_pattern, text)

        found_dl = dl_match.group(1) if dl_match else None

        if found_dl:
            return {
                "verified": True,
                "document_type": "Driving License",
                "extracted_number": found_dl,
                "raw_text": text.strip()[:200] # Return first 200 chars for logging
            }

        return {
            "verified": False,
            "document_type": "Unknown",
            "extracted_number": None,
            "raw_text": text.strip()[:200]
        }

ocr_verifier = OCRVerifier()
