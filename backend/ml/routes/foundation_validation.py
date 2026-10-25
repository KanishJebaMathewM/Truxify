"""Input boundaries shared by the foundation model routes."""

import json
import re
from pathlib import Path

MAX_UPLOAD_BYTES = 10_000_000
MAX_TRAINING_SAMPLES = 10_000
_MODEL_NAME = re.compile(r"foundation_model(?:_v[1-9][0-9]*)?\.pth\Z")


class UploadTooLarge(ValueError):
    """The uploaded training data exceeds the endpoint's memory budget."""


def safe_model_path(path: str) -> str:
    """Keep model checkpoints inside the intended model filename family."""
    if not isinstance(path, str) or "\\" in path:
        raise ValueError("Invalid model path")
    parts = Path(path).parts
    if len(parts) == 1:
        filename = parts[0]
    elif len(parts) == 2 and parts[0] == "models":
        filename = parts[1]
    else:
        raise ValueError("Model path must be inside models/")
    if not _MODEL_NAME.fullmatch(filename):
        raise ValueError("Model filename is not allowed")
    return str(Path("models") / filename)


async def read_training_json(file):
    """Read at most 10 MB and validate the list-of-records training format."""
    if not file.filename or not file.filename.lower().endswith(".json"):
        raise ValueError("A JSON file is required")
    if file.content_type not in ("application/json", "text/json"):
        raise ValueError("Content type must be JSON")
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise UploadTooLarge("Training data exceeds 10 MB")
    try:
        data = json.loads(content)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("Training data must be valid JSON") from exc
    if not isinstance(data, list) or not 1 <= len(data) <= MAX_TRAINING_SAMPLES:
        raise ValueError("Training data must contain 1 to 10000 records")
    text_fields = ("origin", "destination", "cargo_type", "route")
    for item in data:
        if not isinstance(item, dict):
            raise ValueError("Every training record must be an object")
        if any(not isinstance(item.get(field, ""), str) or len(item.get(field, "")) > 1000
               for field in text_fields):
            raise ValueError("Training text fields must be strings of at most 1000 characters")
    return data
