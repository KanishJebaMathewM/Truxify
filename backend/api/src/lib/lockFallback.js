import { acquireLock, releaseLock, LockAcquisitionError } from './redisLock.js';
import logger from '../middleware/logger.js';
import { acquireLocalMutex } from './localMutex.js';

// In-process mutex fallback used when Redis is unavailable. The distributed
// Redis lock fails closed (LockAcquisitionError) by design (see redisLock.js),
// but not every critical section needs cross-instance exclusion. This helper
// lets order/escrow-flavoured flows degrade to a single-process mutex so the
// API stays available during a Redis outage instead of 500ing every request.
//
// The mutex is the shared lease-based implementation in localMutex.js: each
// holder's TTL starts when the lock is GRANTED (not when the caller queued),
// and a stale release() can never free a lease that now belongs to someone else.
async function acquireLocal(resourceKey, ttlMs) {
  const lease = await acquireLocalMutex(resourceKey, ttlMs);
  return {
    ok: true,
    release: async () => {
      lease.release();
    },
  };
}

/**
 * Acquire a Redis distributed lock with an in-process fallback.
 *
 * Resolution:
 *   - `{ ok: true, release }`  → lock acquired (Redis or in-process fallback).
 *   - `{ ok: false, release }` → lock is held by another holder; caller should
 *                                respond 409 and NOT run the critical section.
 *   - Re-throws any non-LockAcquisitionError.
 */
export async function acquireLockOrFallback(resourceKey, ttlMs = 30_000) {
  try {
    const lockValue = await acquireLock(resourceKey, ttlMs);
    if (lockValue === null) {
      return { ok: false, release: async () => {} };
    }
    return {
      ok: true,
      release: async () => {
        await releaseLock(resourceKey, lockValue);
      },
    };
  } catch (err) {
    if (err instanceof LockAcquisitionError) {
      logger.warn({ resourceKey }, 'Redis unavailable for distributed lock; using in-process fallback lock');
      return acquireLocal(resourceKey, ttlMs);
    }
    throw err;
  }
}
