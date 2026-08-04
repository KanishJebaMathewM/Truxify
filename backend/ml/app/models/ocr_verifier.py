import pytesseract
from PIL import Image
import io
import logging
import re

logger = logging.getLogger(__name__)


class OCRVerifier:
    def __init__(self):
        # In a real environment, you might need to set the tesseract_cmd path if it's not in PATH
        # pytesseract.pytesseract.tesseract_cmd = r'/usr/bin/tesseract'
        pass

    def extract_text(self, image_bytes: bytes) -> str:
        """
        Extract text from an image using Tesseract OCR.

        Raises:
            Exception: If OCR extraction fails.
        """
        try:
            image = Image.open(io.BytesIO(image_bytes))
            text = pytesseract.image_to_string(image)
            return text
        except Exception as e:
            logger.error("OCR extraction failed: %s", e)
            raise

    def verify_license(self, text: str) -> dict:
        """
        Searches for a typical Indian Driving License pattern.
        """
        # Common pattern:
        # DL-1420110012345
        dl_pattern = r"([A-Z]{2}[-\s]?\d{2}[-\s]?\d{4}[-\s]?\d{7})"

        dl_match = re.search(dl_pattern, text)
        found_dl = dl_match.group(1) if dl_match else None

        if found_dl:
            return {
                "verified": True,
                "document_type": "Driving License",
                "extracted_number": found_dl,
                "raw_text": text.strip()[:200]
            }

        return {
            "verified": False,
            "document_type": "Unknown",
            "extracted_number": None,
            "raw_text": text.strip()[:200]
        }


ocr_verifier = OCRVerifier()