import { acquireLock, releaseLock, LockAcquisitionError } from './redisLock.js';
import logger from '../middleware/logger.js';

// In-process mutex fallback used when Redis is unavailable. The distributed
// Redis lock fails closed (LockAcquisitionError) by design (see redisLock.js),
// but not every critical section needs cross-instance exclusion. This helper
// lets order/escrow-flavoured flows degrade to a single-process mutex so the
// API stays available during a Redis outage instead of 500ing every request.
const localQueues = new Map();

function acquireLocal(resourceKey, ttlMs) {
  const tail = localQueues.get(resourceKey) ?? Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const chain = tail.then(() => gate);
  localQueues.set(resourceKey, chain);

  let released = false;
  const doRelease = () => {
    if (released) return;
    released = true;
    release();
    chain.then(() => {
      if (localQueues.get(resourceKey) === chain) {
        localQueues.delete(resourceKey);
      }
    });
  };

  const timer = setTimeout(doRelease, ttlMs);
  return tail.then(() => ({
    ok: true,
    release: async () => {
      clearTimeout(timer);
      doRelease();
    },
  }));
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
