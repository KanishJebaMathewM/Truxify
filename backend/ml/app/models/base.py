import asyncio
import inspect
import json
import hashlib
import hmac
import logging
import os
import pickle
import shutil
import threading
import uuid
from datetime import datetime
from typing import Any, Optional

logger = logging.getLogger(__name__)

MODEL_STORAGE_DIR = os.environ.get(
    "MODEL_STORAGE_DIR",
    os.path.join(os.path.dirname(__file__), "..", "..", "models_storage"),
)
MODEL_ARTIFACT_SIGNATURE_DIR = os.environ.get(
    "MODEL_ARTIFACT_SIGNATURE_DIR",
    os.path.join(os.path.dirname(MODEL_STORAGE_DIR), "model_signatures"),
)

# ---------------------------------------------------------------------------
# Model-scoped locking.
#
# Two levels of mutual exclusion protect model artifacts:
#
# 1. _get_lock()/get_model_lock(): an ``asyncio.Lock`` per model used on the
#    event loop to serialize whole training requests for the same model
#    (see ensure_model_loaded() and the /train endpoints).
# 2. _get_write_lock(): a ``threading.Lock`` per model held around every
#    synchronous artifact publication (publish_model() / restore_previous_model()).
#    This is required because training actually executes on worker threads
#    (executor), where an asyncio.Lock cannot be used, and multiple threads
#    (an HTTP-triggered retrain racing a lazy auto-train from a prediction)
#    can otherwise write the same model concurrently.
# ---------------------------------------------------------------------------
MODEL_STORAGE_DIR = os.environ.get(
    "MODEL_STORAGE_DIR",
    os.path.join(os.path.dirname(__file__), "..", "..", "models_storage"),
)

_model_locks: dict[str, asyncio.Lock] = {}
_model_write_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _get_lock(model_name: str) -> "asyncio.Lock":
    if model_name not in _model_locks:
        _model_locks[model_name] = asyncio.Lock()
    return _model_locks[model_name]


def get_model_lock(model_name: str) -> "asyncio.Lock":
    """Return the event-loop-level lock serializing trainings of *model_name*."""
    return _get_lock(model_name)


def _get_write_lock(model_name: str) -> threading.Lock:
    """Return the thread-level lock serializing artifact writes for *model_name*."""
    with _locks_guard:
        lock = _model_write_locks.get(model_name)
        if lock is None:
            lock = threading.Lock()
            _model_write_locks[model_name] = lock
        return lock


class TrainingCancelled(Exception):
    """Raised when a training run is cancelled (e.g. its HTTP request timed
    out) and must not publish a new model generation.

    Backwards-compatible alias; the canonical definition lives in
    app/execution.py where the training-timeout machinery is implemented.
    """


def _training_cancelled() -> bool:
    """Return True when the calling worker thread's training job was cancelled."""
    try:
        from ..execution import is_training_cancelled
        return is_training_cancelled()
    except Exception:
        return False


def _raise_if_cancelled(model_name: str) -> None:
    """Raise TrainingCancelled when the calling training worker timed out."""
    from ..execution import TrainingCancelled as _ExecutionTrainingCancelled
    if _training_cancelled():
        logger.warning("Not publishing '%s': training run was cancelled", model_name)
        raise _ExecutionTrainingCancelled(f"Training for '{model_name}' was cancelled")


# ---------------------------------------------------------------------------
# Paths.
#
# Layout per model inside MODEL_STORAGE_DIR:
#
#   <name>_active.json            # {"generation": "<genid>"}  (atomic pointer)
#   <name>_previous_active.json   # previous generation pointer (rollback)
#   <name>.pkl / <name>_meta.json # legacy flat mirrors, kept for compatibility
#   generations/<name>/<genid>/
#       model.pkl                 # immutable generation artifact
#       meta.json                 # generation metadata (matches the artifact)
#
# Internal readers (load_model / get_model_meta / model_exists) resolve the
# active generation through the pointer, so they can never observe a mixed
# model/metadata state: the pointer is swapped atomically and only after a
# fully validated generation has been written.
# ---------------------------------------------------------------------------

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


def _generations_root(model_name: str) -> str:
    return os.path.join(MODEL_STORAGE_DIR, "generations", model_name)


def _generation_dir(model_name: str, generation: str) -> str:
    return os.path.join(_generations_root(model_name), generation)


def _generation_model_path(model_name: str, generation: str) -> str:
    return os.path.join(_generation_dir(model_name, generation), "model.pkl")


def _generation_meta_path(model_name: str, generation: str) -> str:
    return os.path.join(_generation_dir(model_name, generation), "meta.json")


def _active_ptr_path(model_name: str) -> str:
    return os.path.join(MODEL_STORAGE_DIR, f"{model_name}_active.json")


def _previous_ptr_path(model_name: str) -> str:
    return os.path.join(MODEL_STORAGE_DIR, f"{model_name}_previous_active.json")


def _generate_generation_id() -> str:
    return f"gen_{datetime.now().strftime('%Y%m%d%H%M%S%f')}_{uuid.uuid4().hex[:8]}"


def _read_pointer(path: str) -> Optional[str]:
    try:
        with open(path, "r") as file:
            generation = json.load(file).get("generation")
    except (OSError, ValueError, TypeError):
        return None
    return generation if isinstance(generation, str) else None


def get_active_generation(model_name: str) -> Optional[str]:
    return _read_pointer(_active_ptr_path(model_name))


def get_previous_generation(model_name: str) -> Optional[str]:
    return _read_pointer(_previous_ptr_path(model_name))


def _atomic_write_json(path: str, data: dict) -> None:
    temporary_path = f"{path}.{uuid.uuid4().hex}.tmp"
    with open(temporary_path, "w") as file:
        json.dump(data, file)
        file.flush()
        os.fsync(file.fileno())
    os.replace(temporary_path, path)


def _generation_exists(model_name: str, generation: str) -> bool:
    return os.path.exists(_generation_model_path(model_name, generation))


def _mirror_to_flat(model_name: str, generation: str) -> None:
    for source, destination in (
        (_generation_model_path(model_name, generation), get_model_path(model_name)),
        (_generation_meta_path(model_name, generation), get_meta_path(model_name)),
    ):
        temporary_path = f"{destination}.{uuid.uuid4().hex}.tmp"
        with open(source, "rb") as source_file, open(temporary_path, "wb") as destination_file:
            shutil.copyfileobj(source_file, destination_file)
            destination_file.flush()
            os.fsync(destination_file.fileno())
        os.replace(temporary_path, destination)


def _artifact_signature_path(path: str) -> str:
    artifact_id = hashlib.sha256(os.path.abspath(path).encode()).hexdigest()
    os.makedirs(MODEL_ARTIFACT_SIGNATURE_DIR, exist_ok=True)
    return os.path.join(MODEL_ARTIFACT_SIGNATURE_DIR, f"{artifact_id}.sig")


def _artifact_hmac_key() -> bytes:
    key = os.environ.get("MODEL_ARTIFACT_HMAC_KEY")
    if not key:
        raise RuntimeError("MODEL_ARTIFACT_HMAC_KEY must be configured to load or save model artifacts")
    return key.encode()


def _sign_artifact(path: str) -> None:
    digest = hmac.new(_artifact_hmac_key(), digestmod=hashlib.sha256)
    with open(path, "rb") as file:
        for chunk in iter(lambda: file.read(8192), b""):
            digest.update(chunk)
    signature_path = _artifact_signature_path(path)
    temporary_path = f"{signature_path}.{uuid.uuid4().hex}.tmp"
    with open(temporary_path, "w") as file:
        file.write(digest.hexdigest())
        file.flush()
        os.fsync(file.fileno())
    os.replace(temporary_path, signature_path)


def _verify_artifact(path: str) -> bool:
    signature_path = _artifact_signature_path(path)
    try:
        with open(signature_path, "r") as file:
            expected = file.read().strip()
        digest = hmac.new(_artifact_hmac_key(), digestmod=hashlib.sha256)
        with open(path, "rb") as file:
            for chunk in iter(lambda: file.read(8192), b""):
                digest.update(chunk)
        return hmac.compare_digest(digest.hexdigest(), expected)
    except (OSError, RuntimeError):
        return False

def get_model_hash_path(model_name: str) -> str:
    os.makedirs(MODEL_STORAGE_DIR, exist_ok=True)
    return os.path.join(MODEL_STORAGE_DIR, f"{model_name}.sha256")

def get_previous_model_hash_path(model_name: str) -> str:
    os.makedirs(MODEL_STORAGE_DIR, exist_ok=True)
    return os.path.join(MODEL_STORAGE_DIR, f"{model_name}_previous.sha256")

def _compute_model_hash(model_name: str) -> str:
    path = get_model_path(model_name)
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()

def _save_model_hash(model_name: str) -> None:
    with open(get_model_hash_path(model_name), "w") as f:
        f.write(_compute_model_hash(model_name))

def _model_hash_exists(model_name: str) -> bool:
    return os.path.exists(get_model_hash_path(model_name))

def _verify_model_hash(model_name: str) -> bool:
    """Return True only if the persisted .pkl matches its sha256 sidecar.

    A missing or mismatched hash means the artifact was tampered with or
    silently corrupted and must NOT be unpickled (prevents RCE, #13095).
    """
    if not _model_hash_exists(model_name):
        return False
    expected = ""
    with open(get_model_hash_path(model_name), "r") as f:
        expected = f.read().strip()
    return _compute_model_hash(model_name) == expected

def _verify_previous_model_hash(model_name: str) -> bool:
    """Validate the *_previous.pkl artifact against its sha256 sidecar."""
    prev_path = get_previous_model_path(model_name)
    prev_hash_path = get_previous_model_hash_path(model_name)
    if not os.path.exists(prev_path) or not os.path.exists(prev_hash_path):
        return False
    h = hashlib.sha256()
    with open(prev_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    expected = open(prev_hash_path).read().strip()
    return h.hexdigest() == expected

def save_model(model: Any, model_name: str, metrics: Optional[dict] = None, training_meta: Optional[dict] = None) -> None:
    """Persist *model* as the production version for *model_name*.

    Before overwriting, the current production model (if any) is preserved
    as the "previous" version so restore_previous_model() has something
    real to roll back to, instead of the old behaviour of unconditionally
    clobbering the only copy on disk via os.replace().

    Args:
        model: The model object to persist.
        model_name: Name of the model.
        metrics: Optional metrics dict.
        training_meta: Optional training metadata (source, timestamp, feature_hash, etc.).
    """
    with _get_write_lock(model_name):
        generation = _generate_generation_id()
        generation_dir = _generation_dir(model_name, generation)
        os.makedirs(generation_dir, exist_ok=True)
        model_path = _generation_model_path(model_name, generation)
        meta_path = _generation_meta_path(model_name, generation)
        model_tmp = f"{model_path}.{uuid.uuid4().hex}.tmp"
        meta_tmp = f"{meta_path}.{uuid.uuid4().hex}.tmp"
        meta = {
            "model_name": model_name,
            "generation": generation,
            "saved_at": datetime.now().isoformat(),
            "metrics": metrics or {},
        }
        if training_meta:
            meta["training_meta"] = training_meta
        try:
            with open(model_tmp, "wb") as file:
                pickle.dump(model, file)
                file.flush()
                os.fsync(file.fileno())
            with open(meta_tmp, "w") as file:
                json.dump(meta, file, indent=2)
                file.flush()
                os.fsync(file.fileno())
            with open(model_tmp, "rb") as file:
                if pickle.load(file) is None:
                    raise ValueError(f"Generated artifact for '{model_name}' is empty")
            os.replace(model_tmp, model_path)
            os.replace(meta_tmp, meta_path)
            _sign_artifact(model_path)
            active_path = _active_ptr_path(model_name)
            previous_path = _previous_ptr_path(model_name)
            current = get_active_generation(model_name)
            if current:
                _atomic_write_json(previous_path, {"generation": current})
            _atomic_write_json(active_path, {"generation": generation})
            _mirror_to_flat(model_name, generation)
            _sign_artifact(get_model_path(model_name))
        finally:
            for temporary_path in (model_tmp, meta_tmp):
                try:
                    os.remove(temporary_path)
                except OSError:
                    pass
    logger.info("Model '%s' generation %s published", model_name, generation)


def publish_model(model: Any, model_name: str, metrics: Optional[dict] = None) -> str:
    """Publish a model and return its active generation identifier."""
    save_model(model, model_name, metrics)
    return get_active_generation(model_name) or "production"


def delete_model(model_name: str) -> None:
    """Remove persisted generations and compatibility mirrors for a model."""
    with _get_write_lock(model_name):
        for path in (
            get_model_path(model_name),
            get_meta_path(model_name),
            _active_ptr_path(model_name),
            _previous_ptr_path(model_name),
        ):
            try:
                os.remove(path)
            except OSError:
                pass
        shutil.rmtree(_generations_root(model_name), ignore_errors=True)

def restore_previous_model(model_name: str) -> bool:
    """Roll back *model_name* to its previously-published generation.

    The active and previous pointers are swapped so the rollback itself is
    reversible (mirroring the old flat-file semantics). Returns False (no-op)
    when there is no previous generation to restore.
    """
    with _get_write_lock(model_name):
        active_path = _active_ptr_path(model_name)
        previous_path = _previous_ptr_path(model_name)
        current = get_active_generation(model_name)
        previous = get_previous_generation(model_name)
        if previous is None or not _generation_exists(model_name, previous):
            logger.warning("No previous generation of model '%s' to restore", model_name)
            return False
        _atomic_write_json(active_path, {"generation": previous})
        if current and _generation_exists(model_name, current):
            _atomic_write_json(previous_path, {"generation": current})
        _mirror_to_flat(model_name, previous)
        logger.warning("Model '%s' rolled back to generation %s", model_name, previous)
        return True


# ---------------------------------------------------------------------------
# Readers
# ---------------------------------------------------------------------------

def _generation_candidates(model_name: str):
    """Active generation first, then the previous one (for crash recovery),
    then the legacy flat file path.

    A generation is only considered readable when its model artifact exists, so
    a crash that leaves an incomplete generation never surfaces as a
    model/metadata mix: both readers fall back to the previous valid generation.
    """
    seen = set()
    for gen in (get_active_generation(model_name), get_previous_generation(model_name)):
        if not gen or gen in seen:
            continue
        seen.add(gen)
        model_path = _generation_model_path(model_name, gen)
        if not os.path.exists(model_path):
            logger.warning(
                "Generation %s of model '%s' has no model artifact; skipping",
                gen,
                model_name,
            )
            continue
        yield model_path, _generation_meta_path(model_name, gen)
    yield get_model_path(model_name), get_meta_path(model_name)

def load_model(model_name: str) -> Optional[Any]:
    for path, _ in _generation_candidates(model_name):
        if os.path.exists(path):
            if not _verify_artifact(path):
                logger.error(" refusing to load unsigned or invalid model artifact: %s", path)
                continue
            with open(path, "rb") as file:
                return pickle.load(file)
    logger.warning("Model '%s' not found", model_name)
    return None

def model_exists(model_name: str) -> bool:
    for model_path, _ in _generation_candidates(model_name):
        if os.path.exists(model_path):
            return True
    return False


def get_model_meta(model_name: str) -> Optional[dict]:
    """Return the persisted metadata dict for the active model, or None."""
    for _, meta_path in _generation_candidates(model_name):
        if not os.path.exists(meta_path):
            continue
        try:
            with open(meta_path, "r") as f:
                return json.load(f)
        except Exception:
            logger.warning("Failed to read metadata for model '%s'", model_name)
            continue
    return None


def get_generation_meta(model_name: str, generation: str) -> Optional[dict]:
    """Return the metadata for a specific (already persisted) generation."""
    path = _generation_meta_path(model_name, generation)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r") as f:
            return json.load(f)
    except Exception:
        logger.warning("Failed to read metadata for model '%s' generation %s", model_name, generation)
        return None


# ---------------------------------------------------------------------------
# Startup / lazy loading
# ---------------------------------------------------------------------------

def cleanup_stale_training_artifacts(model_name: Optional[str] = None) -> None:
    """Remove temporary artifacts left behind by crashed or cancelled runs.

    Only files matching the unique-temp pattern are removed; active and
    previous generations are never touched. When *model_name* is None all
    models under MODEL_STORAGE_DIR are swept.
    """
    if model_name is not None:
        names = [model_name]
    else:
        root = os.path.join(MODEL_STORAGE_DIR, "generations")
        if os.path.isdir(root):
            names = os.listdir(root)
        else:
            names = []
        names = [n for n in names if os.path.isdir(os.path.join(root, n))]

    for name in names:
        gen_root = _generations_root(name)
        if os.path.isdir(gen_root):
            for gen in os.listdir(gen_root):
                _cleanup_generation_temps(name, gen)
        for entry in os.listdir(MODEL_STORAGE_DIR):
            if entry.endswith(".tmp") and (
                entry.startswith(f"{name}_") or entry.startswith(f"{name}.")
            ):
                try:
                    os.remove(os.path.join(MODEL_STORAGE_DIR, entry))
                except OSError:
                    pass


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
    cleanup_stale_training_artifacts()
    available = set()
    for name in SUPPORTED_MODELS:
        if model_exists(name):
            logger.info("Model '%s' already exists at startup", name)
            available.add(name)
        else:
            logger.info("Model '%s' not found at startup, will train on first request", name)
    return available
