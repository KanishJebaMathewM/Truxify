"""Complete federated HTTP jobs on existing bounded native execution."""

from functools import wraps
from threading import RLock

from app.execution import run_inference
from fastapi import HTTPException

MAX_CACHED_CLIENTS = 64
_OWNER = RLock()


def _owned(function, args, kwargs):
    # Owned by the native callable, never by the lifetime of an HTTP waiter.
    if not _OWNER.acquire(blocking=False):
        raise HTTPException(status_code=503, detail='A federated HTTP operation is already running')
    try:
        return function(*args, **kwargs)
    finally:
        _OWNER.release()


def native_http_operation(function):
    """Keep all native orchestration/cache work off the request event loop."""
    @wraps(function)
    async def run(*args, **kwargs):
        return await run_inference(_owned, function, args, kwargs)
    return run


def cached_client(cache, client_id, create):
    """Preserve one cached native client; never evict a live subscriber."""
    with _OWNER:
        if client_id not in cache:
            if len(cache) >= MAX_CACHED_CLIENTS:
                raise HTTPException(status_code=503, detail='Federated HTTP client capacity reached')
            cache[client_id] = create()
        return cache[client_id]
