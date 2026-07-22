import os
import json
import pickle
import logging
import asyncio
from typing import Any, Optional
from datetime import datetime

logger = logging.getLogger(__name__)

MODEL_STORAGE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "models_storage")

_model_locks: dict[str, asyncio.Lock] = {}

def _get_lock(model_name: str) -> asyncio.Lock:
    if model_name not in _model_locks:
        _model_locks[model_name] = asyncio.Lock()
    return _model_locks[model_name]

def get_model_path(model_name: str) -> str:
    os.makedirs(MODEL_STORAGE_DIR, exist_ok=True)
    return os.path.join(MODEL_STORAGE_DIR, f"{model_name}.pkl")

def get_meta_path(model_name: str) -> str:
    os.makedirs(MODEL_STORAGE_DIR, exist_ok=True)
    return os.path.join(MODEL_STORAGE_DIR, f"{model_name}_meta.json")

def save_model(model: Any, model_name: str, metrics: Optional[dict] = None) -> None:
    path = get_model_path(model_name)
    tmp_path = path + ".tmp"
    with open(tmp_path, "wb") as f:
        pickle.dump(model, f)
    os.replace(tmp_path, path)

    meta = {
        "model_name": model_name,
        "saved_at": datetime.now().isoformat(),
        "metrics": metrics or {},
    }
    meta_tmp = get_meta_path(model_name) + ".tmp"
    with open(meta_tmp, "w") as f:
        json.dump(meta, f, indent=2)
    os.replace(meta_tmp, get_meta_path(model_name))
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

async def ensure_model_loaded(model_name: str, train_fn, *args, **kwargs) -> Optional[Any]:
    async with _get_lock(model_name):
        if not model_exists(model_name):
            logger.info("Model '%s' not found, training...", model_name)
            train_fn(*args, **kwargs)
        return load_model(model_name)

SUPPORTED_MODELS: list[str] = [
    "demand_forecast",
    "price_forecast",
    "driver_profit",
    "trust_scorer",
    "collaborative_filter",
]


def check_models_exist() -> set[str]:
    """Return the set of persisted model names that exist on disk."""
    return {name for name in SUPPORTED_MODELS if model_exists(name)}


async def preload_all_models() -> set[str]:
    """Verify which persisted models exist at startup.

    Returns the set of model names found on disk so the caller can
    populate runtime tracking without hardcoding.
    """
    available = set()
    for name in SUPPORTED_MODELS:
        if model_exists(name):
            logger.info("Model '%s' already exists at startup", name)
            available.add(name)
        else:
            logger.info("Model '%s' not found at startup, will train on first request", name)
    return available
