/**
 * In-process, per-key FIFO mutex with *leases*.
 *
 * Used as the degraded-mode fallback for the Redis distributed locks
 * (`redisLock.js` and `lockFallback.js`) when Redis is unavailable.
 *
 * Semantics deliberately mirror a Redis `SET key token NX EX ttl` lock:
 *
 *   - The lease (TTL) starts when the lock is GRANTED, never when the caller
 *     starts waiting. A waiter queued behind a slow holder therefore still
 *     receives a full lease once it reaches the front of the queue.
 *   - A lease that expires is released automatically so a crashed or stuck
 *     holder cannot deadlock the key forever.
 *   - A handle is fenced to its own lease: calling `release()` after the
 *     lease already expired (or was released) is a harmless no-op and can
 *     never free a lease that has since been granted to someone else.
 *
 * The previous implementation (duplicated in redisLock.js and lockFallback.js)
 * armed the expiry timer when the caller *enqueued*. Under contention a waiter
 * could "expire" before it was even granted, which released its gate to the
 * next waiter at the same instant and let several callers run the critical
 * section concurrently.
 */

/** Used when a caller passes a missing / non-positive / non-finite TTL. */
export const DEFAULT_LOCAL_LEASE_MS = 30_000;

/** @type {Map<string, { owner: object|null, waiters: Array<() => void> }>} */
const states = new Map();

function normaliseTtl(ttlMs) {
  return Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_LOCAL_LEASE_MS;
}

/**
 * Acquire the in-process mutex for `key`, waiting (FIFO) until it is granted.
 *
 * @param {string} key
 * @param {number} [ttlMs]  Lease length in milliseconds, counted from the moment
 *                          the lock is granted (not from the call).
 * @returns {Promise<{
 *   release: () => boolean,
 *   extend: (ttlMs?: number) => boolean,
 *   isHeld: () => boolean,
 * }>}
 */
export function acquireLocalMutex(key, ttlMs) {
  const leaseMs = normaliseTtl(ttlMs);

  return new Promise((resolve) => {
    let state = states.get(key);
    if (!state) {
      state = { owner: null, waiters: [] };
      states.set(key, state);
    }
    const keyState = state;

    const grant = () => {
      const lease = { active: true, timer: null };
      keyState.owner = lease;

      const arm = (ms) => {
        clearTimeout(lease.timer);
        lease.timer = setTimeout(release, ms);
        lease.timer.unref?.();
      };

      function release() {
        // Fenced: a stale handle (already released / lease expired) is a no-op.
        if (!lease.active) return false;
        lease.active = false;
        clearTimeout(lease.timer);

        if (keyState.owner === lease) keyState.owner = null;

        const next = keyState.waiters.shift();
        if (next) {
          next(); // hand the lock to the next waiter; its lease starts now
        } else if (states.get(key) === keyState) {
          states.delete(key); // nobody waiting: drop the entry (no leak)
        }
        return true;
      }

      arm(leaseMs);

      resolve({
        release,
        /** Push the expiry out by `ms` from now; false if the lease is gone. */
        extend: (ms) => {
          if (!lease.active) return false;
          arm(normaliseTtl(ms ?? leaseMs));
          return true;
        },
        isHeld: () => lease.active,
      });
    };

    if (keyState.owner === null) {
      grant();
    } else {
      keyState.waiters.push(grant);
    }
  });
}

/** Test helper: number of keys that currently have an owner or waiters. */
export function __localMutexKeyCount() {
  return states.size;
}
