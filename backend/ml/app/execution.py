"""Bounded execution helpers for CPU-bound / blocking ML work.

FastAPI async endpoints must never run CPU-bound inference or blocking I/O
directly on the event loop: a single expensive request would stall every
other request, including ``/health``.  This module provides a shared, bounded
``ThreadPoolExecutor`` plus process-wide admission so expensive inference is
executed off the event loop with a configurable concurrency cap and
deterministic backpressure (HTTP 503 when saturated).

Configuration (environment variables):

- ``ML_MAX_CONCURRENT_INFERENCE``         max in-flight inferences (default 4).
- ``ML_INFERENCE_MAX_WORKERS``            executor threads (default 4).
- ``ML_INFERENCE_QUEUE_TIMEOUT_SECONDS``  how long a request waits for an
  inference slot before the service sheds load with 503 (default 5.0).
- ``ML_INFERENCE_MAX_WAITERS``            bounded admission waiters (default32).
- ``ML_INFERENCE_TIMEOUT_SECONDS``       response deadline (default30seconds).

The executor has application/process lifetime: it is created once at import
time and reused for every request.  ``close_inference_executor`` is wired into
the FastAPI shutdown hook so no worker threads leak.

Admission counters are protected by a native threading lock. Async waiters are
bounded and poll without blocking the loop. Native future completion owns slot
release, including after an HTTP timeout/disconnect or event-loop shutdown.
"""

import asyncio
import logging
import math
import os
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from fastapi import HTTPException

logger = logging.getLogger(__name__)

ML_MAX_CONCURRENT_INFERENCE = int(
    os.environ.get("ML_MAX_CONCURRENT_INFERENCE", "4")
)
ML_INFERENCE_MAX_WORKERS = int(os.environ.get("ML_INFERENCE_MAX_WORKERS", "4"))
ML_INFERENCE_QUEUE_TIMEOUT_SECONDS = float(
    os.environ.get("ML_INFERENCE_QUEUE_TIMEOUT_SECONDS", "5.0")
)
ML_TRAINING_MAX_WORKERS = int(os.environ.get("ML_TRAINING_MAX_WORKERS", "2"))
ML_TRAINING_TIMEOUT_SECONDS = float(
    os.environ.get("ML_TRAINING_TIMEOUT_SECONDS", "300")
)

# The executor worker count must never be smaller than the semaphore limit:
# every task that acquires a slot must be able to run promptly instead of
# piling up behind the executor's internal queue.
if ML_INFERENCE_MAX_WORKERS < ML_MAX_CONCURRENT_INFERENCE:
    logger.warning(
        "ML_INFERENCE_MAX_WORKERS (%d) < ML_MAX_CONCURRENT_INFERENCE (%d); "
        "raising workers to match the concurrency limit",
        ML_INFERENCE_MAX_WORKERS,
        ML_MAX_CONCURRENT_INFERENCE,
    )
    ML_INFERENCE_MAX_WORKERS = ML_MAX_CONCURRENT_INFERENCE

ML_INFERENCE_MAX_WAITERS = int(os.environ.get("ML_INFERENCE_MAX_WAITERS", "32"))
ML_INFERENCE_TIMEOUT_SECONDS = float(os.environ.get("ML_INFERENCE_TIMEOUT_SECONDS", "30"))

def _validate_inference_limits(max_concurrent, max_workers, max_waiters,
                               queue_timeout, inference_timeout) -> None:
    if (not isinstance(max_concurrent, int) or isinstance(max_concurrent, bool) or max_concurrent < 1
            or not isinstance(max_workers, int) or isinstance(max_workers, bool) or max_workers < 1
            or not isinstance(max_waiters, int) or isinstance(max_waiters, bool) or max_waiters < 0
            or not math.isfinite(queue_timeout) or queue_timeout < 0
            or not math.isfinite(inference_timeout) or inference_timeout <= 0):
        raise ValueError("Inference limits must be positive; waiters and queue timeout may be zero")


_validate_inference_limits(ML_MAX_CONCURRENT_INFERENCE, ML_INFERENCE_MAX_WORKERS,
                           ML_INFERENCE_MAX_WAITERS, ML_INFERENCE_QUEUE_TIMEOUT_SECONDS,
                           ML_INFERENCE_TIMEOUT_SECONDS)
_inference_executor: ThreadPoolExecutor = ThreadPoolExecutor(
    max_workers=ML_INFERENCE_MAX_WORKERS,
    thread_name_prefix="ml-inference",
)
# Capacity belongs to native work, not to an HTTP task or an event loop.
_inference_guard = threading.Lock()
_active_inference = 0
_waiting_inference = 0

# Dedicated bounded executor for training jobs so a long-running training can
# never starve the (smaller, latency-sensitive) inference pool.
_training_executor: ThreadPoolExecutor = ThreadPoolExecutor(
    max_workers=ML_TRAINING_MAX_WORKERS,
    thread_name_prefix="ml-training",
)
_training_admission_lock = threading.Lock()
_active_training_models: set[str] = set()

# Cancellation token for the training job currently running on this worker
# thread. It is thread-local because many worker threads may be training
# different models at the same time, and one job's timeout must not cancel
# another job's training.
_training_cancel = threading.local()


class TrainingCancelled(Exception):
    """Raised inside a training worker whose HTTP request timed out.

    The worker thread cannot be killed, but once cancelled it must abort
    before publishing anything so a timed-out request never deploys a model.
    """


def is_training_cancelled() -> bool:
    """Return True when the calling training worker was cancelled (timeout)."""
    event = getattr(_training_cancel, "event", None)
    return event is not None and event.is_set()


def _run_train_with_cancel(
    model_name: str,
    train_fn: Callable[..., Any],
    cancel_event: threading.Event,
    args,
    kwargs,
) -> Any:
    prev = getattr(_training_cancel, "event", None)
    _training_cancel.event = cancel_event
    try:
        return train_fn(*args, **kwargs)
    except TrainingCancelled:
        # The request already timed out and nobody will read this worker's
        # result; swallow the cancellation so the executor has no unobserved
        # exception to report.
        logger.warning("Training worker cancelled; aborting before publication")
        return None
    finally:
        _training_cancel.event = prev
        # A timed-out request does not stop its thread. Keep admission occupied
        # until the worker really exits, including across event loops.
        with _training_admission_lock:
            _active_training_models.discard(model_name)


def _consume_training_result(fut: "asyncio.Future") -> None:
    """Retrieve (and thereby suppress) a timed-out worker's eventual result or
    exception so the executor never logs 'exception was never retrieved'."""
    if fut.cancelled():
        return
    fut.exception()


async def run_training_job(
    model_name: str,
    train_fn: Callable[..., Any],
    *args: Any,
    timeout: float = ML_TRAINING_TIMEOUT_SECONDS,
    **kwargs: Any,
) -> Any:
    """Run a CPU-bound training job off the event loop with a wall-clock timeout.

    Critical semantics: an ``asyncio`` timeout does NOT terminate a Python
    worker thread. When *timeout* elapses this helper returns/raises
    ``asyncio.TimeoutError`` immediately AND signals the worker thread through
    a cancellation token. The worker keeps running in the background but its
    publish step checks ``is_training_cancelled()`` and aborts, so a
    timed-out request can never deploy an untracked/invalid model.

    Admission is bounded by the worker count; overload is rejected with 503
    instead of entering the executor's unbounded queue. A second job for the
    same model receives 409, even while a timed-out worker is winding down.
    """
    loop = asyncio.get_running_loop()
    cancel_event = threading.Event()
    with _training_admission_lock:
        if model_name in _active_training_models:
            raise HTTPException(
                status_code=409, detail="Model training already in progress"
            )
        if len(_active_training_models) >= ML_TRAINING_MAX_WORKERS:
            raise HTTPException(
                status_code=503, detail="ML training capacity exhausted; retry later"
            )
        _active_training_models.add(model_name)
    try:
        future = loop.run_in_executor(
            _training_executor,
            _run_train_with_cancel,
            model_name,
            train_fn,
            cancel_event,
            args,
            kwargs,
        )
    except BaseException:
        with _training_admission_lock:
            _active_training_models.discard(model_name)
        raise
    future.add_done_callback(_consume_training_result)
    try:
        return await asyncio.wait_for(asyncio.shield(future), timeout=timeout)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        logger.warning(
            "Training job '%s' cancelled or exceeded %.1fs; signalling cancellation",
            model_name,
            timeout,
        )
        cancel_event.set()
        raise


def close_training_executor() -> None:
    """Gracefully stop the shared training executor (app shutdown)."""
    _training_executor.shutdown(wait=False, cancel_futures=False)
    logger.info("ML training executor shut down")


async def _acquire_inference() -> None:
    global _active_inference, _waiting_inference
    loop = asyncio.get_running_loop()
    deadline = loop.time() + ML_INFERENCE_QUEUE_TIMEOUT_SECONDS
    with _inference_guard:
        if _active_inference < ML_MAX_CONCURRENT_INFERENCE:
            _active_inference += 1
            return
        if _waiting_inference >= ML_INFERENCE_MAX_WAITERS:
            raise HTTPException(status_code=503, detail="ML inference capacity exhausted; retry later")
        _waiting_inference += 1
    try:
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                raise HTTPException(status_code=503, detail="ML inference capacity exhausted; retry later")
            await asyncio.sleep(min(0.01, remaining))
            with _inference_guard:
                if _active_inference < ML_MAX_CONCURRENT_INFERENCE:
                    _active_inference += 1
                    return
    finally:
        with _inference_guard:
            _waiting_inference -= 1


def _release_inference(_future=None) -> None:
    global _active_inference
    with _inference_guard:
        _active_inference -= 1


def configure(
    *,
    max_concurrent: int = ML_MAX_CONCURRENT_INFERENCE,
    max_workers: int = ML_INFERENCE_MAX_WORKERS,
    queue_timeout: float = ML_INFERENCE_QUEUE_TIMEOUT_SECONDS,
    max_waiters: int = ML_INFERENCE_MAX_WAITERS,
    inference_timeout: float = ML_INFERENCE_TIMEOUT_SECONDS,
) -> None:
    """Test/runtime configuration; retain admission for already-running workers.

    Replacing a pool does not discard old workers' occupied capacity. Native
    completion releases it even if the caller's event loop has already closed.
    """
    global ML_MAX_CONCURRENT_INFERENCE, ML_INFERENCE_MAX_WORKERS
    global ML_INFERENCE_QUEUE_TIMEOUT_SECONDS, _inference_executor
    global ML_INFERENCE_MAX_WAITERS, ML_INFERENCE_TIMEOUT_SECONDS
    _validate_inference_limits(max_concurrent, max_workers, max_waiters,
                               queue_timeout, inference_timeout)
    max_workers = max(max_workers, max_concurrent)
    replacement = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="ml-inference")
    with _inference_guard:
        previous = _inference_executor
        ML_MAX_CONCURRENT_INFERENCE = max_concurrent
        ML_INFERENCE_MAX_WORKERS = max_workers
        ML_INFERENCE_QUEUE_TIMEOUT_SECONDS = queue_timeout
        ML_INFERENCE_MAX_WAITERS = max_waiters
        ML_INFERENCE_TIMEOUT_SECONDS = inference_timeout
        _inference_executor = replacement
    previous.shutdown(wait=False, cancel_futures=False)


def _consume_inference_result(future: "asyncio.Future") -> None:
    # A disconnected/timed-out caller may no longer await a worker exception.
    if not future.cancelled():
        future.exception()


async def run_inference(func: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    """Bound native work and waiting requests across all process event loops.

    Overload is503; an admitted request exceeding the response deadline is504.
    Neither timeout nor disconnect frees its capacity until native completion.
    Python cannot kill an arbitrary worker thread; a permanently stuck worker
    keeps its slot and causes bounded overload rather than unbounded submission.
    """
    await _acquire_inference()
    try:
        with _inference_guard:
            native = _inference_executor.submit(func, *args, **kwargs)
    except BaseException:
        _release_inference()
        raise
    native.add_done_callback(_release_inference)
    future = asyncio.wrap_future(native)
    future.add_done_callback(_consume_inference_result)
    deadline = asyncio.timeout(ML_INFERENCE_TIMEOUT_SECONDS)
    try:
        async with deadline:
            return await asyncio.shield(future)
    except TimeoutError:
        if not deadline.expired():
            raise  # The callable's own TimeoutError is not our response deadline.
        raise HTTPException(status_code=504, detail="ML inference response deadline exceeded") from None


def inference_capacity() -> int:
    """Return the configured maximum number of concurrent inferences."""
    return ML_MAX_CONCURRENT_INFERENCE


def close_inference_executor() -> None:
    """Gracefully stop the shared inference executor (app shutdown)."""
    _inference_executor.shutdown(wait=False, cancel_futures=False)
    logger.info("ML inference executor shut down")
