# Redis Distributed Lock

## Overview

The Truxify backend uses Redis-based distributed locks (`lib/redisLock.js`) to guard critical sections that must run once across all API replicas — escrow reconciliation sweeps, payment lock/accept flows, and per-user verification.

---

## Location

```
backend/api/src/lib/redisLock.js
```

---

## API

### acquireLock(resourceKey, ttlMs)

Acquires a lock with `SET resourceKey <uuid> PX <ttlMs> NX`.

- Returns the owner token (UUID) on success.
- Returns `null` when another process holds the lock.
- **Throws `LockAcquisitionError`** when Redis is unavailable or errors — callers must abort the protected operation (typically returning 503).

### releaseLock(resourceKey, lockValue)

Releases the lock **only if** the caller still owns it, via an atomic Lua script (`GET` + `DEL`). A slow holder whose TTL expired can never delete a newer holder's lock.

- Returns `true` if we held and deleted the lock.
- Returns `false` otherwise (never throws; safe in `finally`).

### renewLock(resourceKey, lockValue, ttlMs)

Extends the TTL only while the caller still owns the lock (atomic Lua `GET` + `PEXPIRE`). Returns `true`/`false`.

---

## Why It Exists

Escrow and payment flows are not idempotent at the database level — two replicas processing the same order could double-release or double-refund. A lock with an owner token and atomic release guarantees mutual exclusion even across processes.

---

## Failure Semantics

- Redis unavailable at acquire → hard failure (`LockAcquisitionError`), not a silent skip.
- Lock held → `null` so callers can back off gracefully.
- Release is atomic and ownership-checked to prevent deleting another holder's lock.

---

## Testing

Automated tests verify:

- Acquire success, held, and error paths.
- Release ownership semantics via the Lua script.
- Renew TTL extension.
- No-op guards without a client or token.
