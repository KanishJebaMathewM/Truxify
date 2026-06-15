import os
import json
import pickle
import logging
from typing import Any, Optional
from datetime import datetime

logger = logging.getLogger(__name__)

MODEL_STORAGE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "models_storage")


def get_model_path(model_name: str) -> str:
    os.makedirs(MODEL_STORAGE_DIR, exist_ok=True)
    return os.path.join(MODEL_STORAGE_DIR, f"{model_name}.pkl")


def get_meta_path(model_name: str) -> str:
    os.makedirs(MODEL_STORAGE_DIR, exist_ok=True)
    return os.path.join(MODEL_STORAGE_DIR, f"{model_name}_meta.json")


def save_model(model: Any, model_name: str, metrics: Optional[dict] = None) -> None:
    path = get_model_path(model_name)
    with open(path, "wb") as f:
        pickle.dump(model, f)

    meta = {
        "model_name": model_name,
        "saved_at": datetime.now().isoformat(),
        "metrics": metrics or {},
    }
    with open(get_meta_path(model_name), "w") as f:
        json.dump(meta, f, indent=2)
    logger.info("Model '%s' saved to %s", model_name, path)


def load_model(model_name: str) -> Optional[Any]:
    path = get_model_path(model_name)
    if not os.path.exists(path):
        logger.warning("Model '%s' not found at %s", model_name, path)
        return None
    with open(path, "rb") as f:
        return pickle.load(f)


def model_exists(model_name: str) -> bool:
    return os.path.exists(get_model_path(model_name))
