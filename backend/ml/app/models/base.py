import asyncio
import hashlib
import hmac
import inspect
import json
import logging
import os
import pickle
import shutil
import threading
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
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
# Counts are accessed only under the corresponding per-model writer lock.
_generation_readers: dict[str, dict[str, int]] = {}
_deleted_reader_models: set[str] = set()


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
# active generation through the pointer. load_model_snapshot reads a matched
# pair under one reservation; separate model/metadata calls remain independent.
# Publication swaps the pointer only after a validated generation is written.
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


def _generate_generation_id(model_name: Optional[str] = None) -> str:
    return f"gen_{datetime.now().strftime('%Y%m%d%H%M%S%f')}_{uuid.uuid4().hex[:8]}"


def _unique_temp(final_path: str) -> str:
    """Return a unique temporary path beside a final artifact."""
    return f"{final_path}.{uuid.uuid4().hex}.tmp"


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


def _prune_generations(model_name: str, keep: set[str]) -> None:
    root = _generations_root(model_name)
    if not os.path.isdir(root):
        if not _generation_readers.get(model_name):
            _deleted_reader_models.discard(model_name)
        return
    reserved = _generation_readers.get(model_name, {})
    try:
        generations = os.listdir(root)
    except FileNotFoundError:
        return  # An independent process may have removed the storage root.
    for generation in generations:
        if generation in keep or reserved.get(generation, 0):
            continue
        shutil.rmtree(_generation_dir(model_name, generation), ignore_errors=True)
    try:
        os.rmdir(root)  # Empty after deferred deletion finishes.
        _deleted_reader_models.discard(model_name)
    except OSError:
        pass


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
    _raise_if_cancelled(model_name)
    with _get_write_lock(model_name):
        _raise_if_cancelled(model_name)
        generation = _generate_generation_id(model_name)
        generation_dir = _generation_dir(model_name, generation)
        os.makedirs(generation_dir, exist_ok=True)
        model_path = _generation_model_path(model_name, generation)
        meta_path = _generation_meta_path(model_name, generation)
        model_tmp = _unique_temp(model_path)
        meta_tmp = _unique_temp(meta_path)
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
            _raise_if_cancelled(model_name)
            os.replace(model_tmp, model_path)
            os.replace(meta_tmp, meta_path)
            _sign_artifact(model_path)
            active_path = _active_ptr_path(model_name)
            previous_path = _previous_ptr_path(model_name)
            current = get_active_generation(model_name)
            if current:
                _atomic_write_json(previous_path, {"generation": current})
            _atomic_write_json(active_path, {"generation": generation})
            _deleted_reader_models.discard(model_name)
            _mirror_to_flat(model_name, generation)
            _sign_artifact(get_model_path(model_name))
            _prune_generations(model_name, {generation, current} - {None})
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
        if _generation_readers.get(model_name):
            _deleted_reader_models.add(model_name)
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
        # Active readers may finish their admitted immutable snapshots. Removing
        # pointers makes new reads miss; reclaim their generations on release.
        _prune_generations(model_name, set())

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


def backup_model(model_name: str) -> Optional[str]:
    """Create an explicit backup generation for *model_name*.

    Copies the currently active generation into a backup generation and updates
    the previous generation pointer, so that a subsequent rollback can restore it.
    Returns the backup generation ID, or None if no active model exists.
    """
    with _get_write_lock(model_name):
        current_gen = get_active_generation(model_name)
        if not current_gen or not _generation_exists(model_name, current_gen):
            if not os.path.exists(get_model_path(model_name)):
                logger.warning("Cannot backup model '%s': no active model exists", model_name)
                return None
            current_gen = _generate_generation_id(model_name)
            current_dir = _generation_dir(model_name, current_gen)
            os.makedirs(current_dir, exist_ok=True)
            shutil.copy2(get_model_path(model_name), _generation_model_path(model_name, current_gen))
            if os.path.exists(get_meta_path(model_name)):
                shutil.copy2(get_meta_path(model_name), _generation_meta_path(model_name, current_gen))
            _sign_artifact(_generation_model_path(model_name, current_gen))
            _atomic_write_json(_active_ptr_path(model_name), {"generation": current_gen})

        backup_gen = _generate_generation_id(model_name)
        backup_dir = _generation_dir(model_name, backup_gen)
        os.makedirs(backup_dir, exist_ok=True)

        source_model = _generation_model_path(model_name, current_gen)
        target_model = _generation_model_path(model_name, backup_gen)
        shutil.copy2(source_model, target_model)

        source_meta = _generation_meta_path(model_name, current_gen)
        target_meta = _generation_meta_path(model_name, backup_gen)
        if os.path.exists(source_meta):
            with open(source_meta, "r") as f:
                meta = json.load(f)
            meta["backup_from_generation"] = current_gen
            meta["backup_timestamp"] = datetime.now().isoformat()
            with open(target_meta, "w") as f:
                json.dump(meta, f, indent=2)
        else:
            with open(target_meta, "w") as f:
                json.dump({"model_name": model_name, "generation": backup_gen, "saved_at": datetime.now().isoformat()}, f, indent=2)

        _sign_artifact(target_model)
        _atomic_write_json(_previous_ptr_path(model_name), {"generation": backup_gen})
        logger.info("Created explicit backup generation '%s' for model '%s'", backup_gen, model_name)
        return backup_gen


def rollback_model(model_name: str) -> dict:
    """Roll back *model_name* to its previous generation and return detailed status.

    Returns a dict with 'rolled_back' (bool), 'active_generation', 'previous_generation',
    and the restored generation's metrics.
    """
    restored = restore_previous_model(model_name)
    active_gen = get_active_generation(model_name)
    meta = get_model_meta(model_name) or {}
    metrics = meta.get("metrics", {})

    if restored:
        logger.warning("Model '%s' successfully rolled back to generation %s", model_name, active_gen)
        return {
            "rolled_back": True,
            "model_name": model_name,
            "active_generation": active_gen,
            "metrics": metrics,
            "message": f"Successfully rolled back {model_name} to generation {active_gen}",
        }

    return {
        "rolled_back": False,
        "model_name": model_name,
        "active_generation": active_gen,
        "metrics": metrics,
        "reason": f"No previous generation available to roll back to for model '{model_name}'.",
    }


def validate_model_performance(new_metrics: dict, previous_metrics: Optional[dict] = None, r2_threshold: float = 0.05) -> dict:
    """Validate new model performance against previous model baseline.

    Rejection Rule (from issue #822):
        If New R² < Previous R² - 0.05 Reject Model
    Also computes percentage change and MAE/RMSE comparisons.
    """
    new_r2 = float(new_metrics.get("r2", 0.0))
    new_mae = float(new_metrics.get("mae", 0.0))
    new_rmse = float(new_metrics.get("rmse", 0.0))

    if not previous_metrics:
        return {
            "should_reject": False,
            "accepted": True,
            "reason": "No previous baseline available; initial model accepted.",
            "r2_diff": 0.0,
            "r2_pct_change": 0.0,
            "new_metrics": new_metrics,
            "previous_metrics": None,
        }

    prev_r2 = float(previous_metrics.get("r2", 0.0))
    prev_mae = float(previous_metrics.get("mae", 0.0))
    prev_rmse = float(previous_metrics.get("rmse", 0.0))

    r2_diff = new_r2 - prev_r2
    r2_pct_change = ((r2_diff) / abs(prev_r2) * 100) if prev_r2 != 0 else (100.0 if r2_diff > 0 else 0.0)

    should_reject = new_r2 < (prev_r2 - r2_threshold)

    if should_reject:
        reason = (
            f"Performance regression detected: New R² ({new_r2:.4f}) dropped more than "
            f"threshold {r2_threshold} below previous R² ({prev_r2:.4f}), delta {r2_pct_change:.1f}%."
        )
    else:
        improved = r2_diff > 0
        direction = "improved" if improved else "maintained"
        reason = (
            f"Performance validation passed: New R² ({new_r2:.4f}) vs previous R² ({prev_r2:.4f}), "
            f"{direction} by {r2_pct_change:+.1f}%."
        )

    return {
        "should_reject": should_reject,
        "accepted": not should_reject,
        "reason": reason,
        "r2_diff": round(r2_diff, 4),
        "r2_pct_change": round(r2_pct_change, 2),
        "mae_diff": round(new_mae - prev_mae, 4),
        "rmse_diff": round(new_rmse - prev_rmse, 4),
        "new_metrics": {"r2": new_r2, "mae": new_mae, "rmse": new_rmse},
        "previous_metrics": {"r2": prev_r2, "mae": prev_mae, "rmse": prev_rmse},
    }


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

@dataclass(frozen=True)
class ModelSnapshot:
    """One admitted model generation and its metadata (None when unavailable).

    Separate load_model/get_model_meta calls remain independent snapshots.
    Callers needing a matched pair should use load_model_snapshot instead.
    """
    model: Any
    metadata: dict | None
    generation: str | None


@contextmanager
def _candidate_lease(model_name: str, model_path: str):
    """Reserve immutable storage before a reader opens it.

    The existing writer lock coordinates process-local readers/reclamation.
    Legacy flat mirrors are mutable, so their complete read holds that lock.
    This does not coordinate independent OS processes sharing the same store.
    """
    lock = _get_write_lock(model_name)
    if model_path == get_model_path(model_name):
        with lock:
            yield model_name not in _deleted_reader_models and os.path.exists(model_path)
        return
    generation = os.path.basename(os.path.dirname(model_path))
    with lock:
        admitted = model_name not in _deleted_reader_models and os.path.exists(model_path)
        if admitted:
            readers = _generation_readers.setdefault(model_name, {})
            readers[generation] = readers.get(generation, 0) + 1
    try:
        yield admitted
    finally:
        if admitted:
            with lock:
                readers = _generation_readers[model_name]
                readers[generation] -= 1
                if readers[generation] == 0:
                    del readers[generation]
                if not readers:
                    del _generation_readers[model_name]
                keep = {get_active_generation(model_name), get_previous_generation(model_name)} - {None}
                _prune_generations(model_name, keep)


def _reader_candidates(model_name: str):
    with _get_write_lock(model_name):
        return [] if model_name in _deleted_reader_models else list(_generation_candidates(model_name))


def _read_candidate_meta(model_name: str, model_path: str, meta_path: str) -> dict | None:
    try:
        with open(meta_path, "r") as file:
            meta = json.load(file)
    except (OSError, ValueError):
        return None
    if not isinstance(meta, dict):
        return None
    if model_path != get_model_path(model_name):
        generation = os.path.basename(os.path.dirname(model_path))
        if meta.get("generation") != generation:
            return None  # Never attach another generation's metadata to this model.
    return meta


def load_model_snapshot(model_name: str) -> ModelSnapshot | None:
    for model_path, meta_path in _reader_candidates(model_name):
        with _candidate_lease(model_name, model_path) as admitted:
            if not admitted:
                continue
            if not _verify_artifact(model_path):
                logger.error("refusing to load unsigned or invalid model artifact: %s", model_path)
                continue
            try:
                with open(model_path, "rb") as file:
                    model = pickle.load(file)
                meta = _read_candidate_meta(model_name, model_path, meta_path)
            except OSError:
                # Another OS process is outside our thread-level reservations;
                # recover to a currently available candidate rather than crash.
                continue
            generation = (os.path.basename(os.path.dirname(model_path))
                          if model_path != get_model_path(model_name) else None)
            return ModelSnapshot(model, meta, generation)
    logger.warning("Model '%s' not found", model_name)
    return None


def load_model(model_name: str) -> Any | None:
    snapshot = load_model_snapshot(model_name)
    return snapshot.model if snapshot is not None else None


def model_exists(model_name: str) -> bool:
    with _get_write_lock(model_name):
        return model_name not in _deleted_reader_models and any(
            os.path.exists(path) for path, _ in _generation_candidates(model_name))


def get_model_meta(model_name: str) -> dict | None:
    """Read one available generation's metadata under its storage reservation."""
    for model_path, meta_path in _reader_candidates(model_name):
        with _candidate_lease(model_name, model_path) as admitted:
            if admitted:
                meta = _read_candidate_meta(model_name, model_path, meta_path)
                if meta is not None:
                    return meta
    return None


def get_generation_meta(model_name: str, generation: str) -> dict | None:
    model_path = _generation_model_path(model_name, generation)
    with _candidate_lease(model_name, model_path) as admitted:
        if not admitted:
            return None
        return _read_candidate_meta(model_name, model_path, _generation_meta_path(model_name, generation))


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


def _cleanup_generation_temps(model_name: str, generation: str) -> None:
    generation_dir = _generation_dir(model_name, generation)
    if not os.path.isdir(generation_dir):
        return
    for entry in os.listdir(generation_dir):
        if entry.endswith(".tmp"):
            try:
                os.remove(os.path.join(generation_dir, entry))
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
