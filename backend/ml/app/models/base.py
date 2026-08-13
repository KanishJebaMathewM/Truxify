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

def get_previous_model_path(model_name: str) -> str:
    os.makedirs(MODEL_STORAGE_DIR, exist_ok=True)
    return os.path.join(MODEL_STORAGE_DIR, f"{model_name}_previous.pkl")

def get_previous_meta_path(model_name: str) -> str:
    os.makedirs(MODEL_STORAGE_DIR, exist_ok=True)
    return os.path.join(MODEL_STORAGE_DIR, f"{model_name}_previous_meta.json")

def save_model(model: Any, model_name: str, metrics: Optional[dict] = None) -> None:
    """Persist *model* as the production version for *model_name*.

    Before overwriting, the current production model (if any) is preserved
    as the "previous" version so restore_previous_model() has something
    real to roll back to, instead of the old behaviour of unconditionally
    clobbering the only copy on disk via os.replace().
    """
    path = get_model_path(model_name)
    meta_path = get_meta_path(model_name)

    if os.path.exists(path):
        os.replace(path, get_previous_model_path(model_name))
    if os.path.exists(meta_path):
        os.replace(meta_path, get_previous_meta_path(model_name))

    tmp_path = path + ".tmp"
    with open(tmp_path, "wb") as f:
        pickle.dump(model, f)
    os.replace(tmp_path, path)

    meta = {
        "model_name": model_name,
        "saved_at": datetime.now().isoformat(),
        "metrics": metrics or {},
    }
    meta_tmp = meta_path + ".tmp"
    with open(meta_tmp, "w") as f:
        json.dump(meta, f, indent=2)
    os.replace(meta_tmp, meta_path)
    logger.info("Model '%s' saved to %s (previous version preserved)", model_name, path)

def restore_previous_model(model_name: str) -> bool:
    """Roll back *model_name* to its previously-saved version.

    Swaps the current production model file/meta with the "_previous"
    copy kept by save_model(). Returns False (no-op) if there is no
    previous version to restore, so callers can distinguish a real
    rollback from a rollback attempted with nothing to roll back to.
    """
    prev_path = get_previous_model_path(model_name)
    prev_meta_path = get_previous_meta_path(model_name)
    if not os.path.exists(prev_path):
        logger.warning("No previous version of model '%s' to restore", model_name)
        return False

    path = get_model_path(model_name)
    meta_path = get_meta_path(model_name)

    # Swap current <-> previous so the rollback itself is also reversible.
    # Uses a ".swap" suffix (not ".tmp") since these files are only ever
    # transient mid-function, not leftover atomic-write artifacts.
    if os.path.exists(path):
        os.replace(path, path + ".swap")
    os.replace(prev_path, path)
    if os.path.exists(path + ".swap"):
        os.replace(path + ".swap", prev_path)

    if os.path.exists(meta_path):
        os.replace(meta_path, meta_path + ".swap")
    if os.path.exists(prev_meta_path):
        os.replace(prev_meta_path, meta_path)
    if os.path.exists(meta_path + ".swap"):
        os.replace(meta_path + ".swap", prev_meta_path)

    logger.warning("Model '%s' rolled back to previous version", model_name)
    return True

def load_model(model_name: str) -> Optional[Any]:
    path = get_model_path(model_name)
    if not os.path.exists(path):
        logger.warning("Model '%s' not found at %s", model_name, path)
        return None
    with open(path, "rb") as f:
        return pickle.load(f)

def model_exists(model_name: str) -> bool:
    return os.path.exists(get_model_path(model_name))

def get_model_meta(model_name: str) -> Optional[dict]:
    """Return the persisted metadata dict for a model, or None."""
    path = get_meta_path(model_name)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r") as f:
            return json.load(f)
    except Exception:
        logger.warning("Failed to read metadata for model '%s'", model_name)
        return None

import inspect
from typing import Any, Optional

async def ensure_model_loaded(model_name: str, train_fn, *args, **kwargs) -> Optional[Any]:
    async with _get_lock(model_name):
        if not model_exists(model_name):
            logger.info("Model '%s' not found, training...", model_name)
            res = train_fn(*args, **kwargs)
            if inspect.isawaitable(res):
                await res
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
