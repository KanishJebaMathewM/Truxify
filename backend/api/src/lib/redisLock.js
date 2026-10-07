import { redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';
import crypto from 'crypto';
import { acquireLocalMutex } from './localMutex.js';

/** Upper bound for lease auto-renewal so a hung holder can never pin a lock forever. */
export const DEFAULT_KEEPALIVE_MAX_HOLD_MS = 5 * 60 * 1000;

/**
 * Wraps the in-process fallback mutex in the `{ acquired, release, isLost }`
 * shape returned by `acquireDistributedLock`.
 */
async function acquireLocalLock(key, ttlMs, keepAliveOptions) {
  const lease = await acquireLocalMutex(key, ttlMs);
  let releasedByCaller = false;

  const keepAlive = startKeepAlive({
    key,
    ttlMs,
    options: keepAliveOptions,
    renew: async () => (lease.extend(ttlMs) ? 'renewed' : 'lost'),
  });

  return {
    acquired: true,
    release: async () => {
      if (releasedByCaller) return false;
      releasedByCaller = true;
      keepAlive.stop();
      return lease.release();
    },
    isLost: () => !releasedByCaller && !lease.isHeld(),
  };
}

/**
 * Starts the optional lease auto-renewal ("keep-alive") loop for a held lock.
 *
 * `renew` must resolve to 'renewed' | 'lost' | 'error':
 *   - 'renewed' → lease extended, keep going
 *   - 'lost'    → we no longer own the lock; stop renewing and report it
 *   - 'error'   → transient failure (e.g. Redis blip); try again next tick
 *
 * Renewal stops at `maxHoldMs` so a hung holder cannot keep a lock alive
 * forever; after that the lease is allowed to lapse naturally.
 */
function startKeepAlive({ key, ttlMs, options, renew }) {
  const state = { lost: false, timer: null };
  const stop = () => {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
  };

  if (!options?.keepAlive) {
    return { stop, isLost: () => state.lost };
  }

  const maxHoldMs = options.maxHoldMs ?? DEFAULT_KEEPALIVE_MAX_HOLD_MS;
  const intervalMs = options.renewIntervalMs ?? Math.max(Math.floor(ttlMs / 3), 250);
  const deadline = Date.now() + maxHoldMs;
  let renewing = false;

  state.timer = setInterval(async () => {
    if (renewing) return;
    if (Date.now() >= deadline) {
      stop();
      logger.warn({ key, maxHoldMs }, '[RedisLock] Lock keep-alive reached maxHoldMs; letting the lease lapse');
      return;
    }
    renewing = true;
    try {
      const outcome = await renew();
      // release()/maxHoldMs stopped the loop while this renewal was in flight:
      // a 'lost' result then just means we released the key ourselves.
      if (state.timer === null) return;
      if (outcome === 'lost') {
        state.lost = true;
        stop();
        logger.error({ key }, '[RedisLock] Lock lease was lost while the critical section was still running');
      } else if (outcome === 'error') {
        logger.warn({ key }, '[RedisLock] Lock lease renewal failed; will retry');
      }
    } finally {
      renewing = false;
    }
  }, intervalMs);
  state.timer.unref?.();

  return { stop, isLost: () => state.lost };
}

/**
 * Acquires a distributed lock using Redis `SET key <owner-token> NX EX ttl`.
 * Falls back to an in-process per-key mutex when Redis is unavailable.
 * 
 * Ownership safety: the stored value is a random per-acquisition token and
 * `release()` is an atomic compare-and-delete (Lua), so a holder whose lease
 * already expired can never delete the lock that now belongs to someone else.
 * (Previously every holder stored the constant '1' and released with a bare
 * `DEL`, so a slow holder's late release freed a *successor's* lock and let a
 * third caller into the critical section.)
 *
 * For critical sections that may legitimately outlive `ttlSeconds` (e.g. waiting
 * for an on-chain confirmation) pass `{ keepAlive: true }`: the lease is then
 * renewed in the background — only while we still own it — until `release()`
 * or `maxHoldMs` is reached.
 *
 * @param {string} key - The unique lock identifier (e.g., lock:profile:uid).
 * @param {number} ttlSeconds - Lease length; prevents deadlocks if the process crashes.
 * @param {object}  [options]
 * @param {boolean} [options.keepAlive=false]  Auto-renew the lease while held.
 * @param {number}  [options.maxHoldMs]        Cap on total auto-renewal time (default 5 min).
 * @param {number}  [options.renewIntervalMs]  Renewal cadence (default ttl/3, min 250 ms).
 * `isLost()` reports whether the lease is known to have been lost before
 * `release()`. For Redis locks it is only meaningful with `keepAlive: true`
 * (renewals are what detect the loss); for the in-process fallback it is exact.
 *
 * @returns {Promise<{acquired: boolean, release: () => Promise<boolean>, isLost: () => boolean}>}
 */
export async function acquireDistributedLock(key, ttlSeconds = 5, options = {}) {
  const ttlMs = Math.round(ttlSeconds * 1000);
  const isRedisReady = redisClient &&
    (redisClient.status === 'ready' || (!redisClient.status && typeof redisClient.set === 'function'));

  if (!isRedisReady) {
    // Degraded / fallback mode: maintain in-process mutual exclusion per key
    return acquireLocalLock(key, ttlMs, options);
  }

  const token = crypto.randomUUID();

  let result;
  try {
    result = await redisClient.set(key, token, 'NX', 'EX', ttlSeconds);
  } catch (err) {
    logger.error({ err, key }, 'Redis lock acquisition error; using local mutex fallback');
    return acquireLocalLock(key, ttlMs, options);
  }

  if (result !== 'OK') {
    return { acquired: false, release: async () => false, isLost: () => false };
  }

  let released = false;
  const keepAlive = startKeepAlive({
    key,
    ttlMs,
    options,
    renew: () => renewOwned(key, token, ttlMs),
  });

  return {
    acquired: true,
    release: async () => {
      if (released) return false; // idempotent: never issue a second release
      released = true;
      keepAlive.stop();
      // Atomic compare-and-delete: only removes the key if it still holds OUR token.
      return releaseLock(key, token);
    },
    isLost: () => keepAlive.isLost(),
  };
}

/**
 * Executes a function with a distributed lock, retrying if the lock is held.
 * 
 * @param {string} key - Lock key
 * @param {Function} fn - Async function to execute
 * @param {object} options - Retry configuration (`ttlSeconds`, `retryDelayMs`,
 *   `maxRetries`) plus the optional `keepAlive` / `maxHoldMs` /
 *   `renewIntervalMs` lease auto-renewal settings of `acquireDistributedLock`.
 */
export async function withLock(key, fn, options = {}) {
  const {
    ttlSeconds = 5,
    retryDelayMs = 100,
    maxRetries = 3,
    keepAlive,
    maxHoldMs,
    renewIntervalMs,
  } = options;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const lock = await acquireDistributedLock(key, ttlSeconds, { keepAlive, maxHoldMs, renewIntervalMs });
    
    if (lock.acquired) {
      try {
        return await fn();
      } finally {
        await lock.release();
      }
    }
    
    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, retryDelayMs));
    }
  }
  
  throw new Error(`Failed to acquire lock for ${key} after ${maxRetries} retries`);
}


/**
 * Thrown when a distributed lock cannot be acquired because Redis is
 * unavailable or an unexpected error occurred during SET NX.
 *
 * Callers MUST catch this and abort the protected operation — typically
 * by returning HTTP 503 Service Unavailable.  This is a hard failure,
 * not a "lock is already held" signal.
 */
export class LockAcquisitionError extends Error {
  constructor(resourceKey, reason) {
    super(`Failed to acquire lock for "${resourceKey}": ${reason}`);
    this.name = 'LockAcquisitionError';
    this.resourceKey = resourceKey;
    this.reason = reason;
  }
}

/**
 * Acquires a distributed Redis lock using SET … NX PX with a random owner
 * token (UUID) so that only the holder can release it.
 *
 * Failure semantics — **fail closed**:
 *   - Returns `null`               → lock is held by another process; caller should back off.
 *   - Throws `LockAcquisitionError` → Redis is unavailable or errored; caller MUST abort
 *                                     the critical section and return 503.
 *
 * @param {string} resourceKey  Unique key for the guarded resource, e.g. `payment_lock:order_123`
 * @param {number} ttlMs        Lock TTL in **milliseconds** (default 30 000 = 30 s)
 * @returns {Promise<string|null>} The owner token (UUID) on success, null if already locked.
 * @throws {LockAcquisitionError}  When Redis is down or SET NX throws.
 */
export async function acquireLock(resourceKey, ttlMs = 30_000) {
  // Redis client not initialised — hard failure, not a silent skip.
  if (!redisClient) {
    throw new LockAcquisitionError(
      resourceKey,
      'Redis client is not initialised — cannot guarantee mutual exclusion'
    );
  }

  if (!resourceKey || typeof resourceKey !== 'string') {
    throw new LockAcquisitionError(
      resourceKey ?? 'undefined',
      'resourceKey must be a non-empty string'
    );
  }

  const lockValue = crypto.randomUUID();

  try {
    const result = await redisClient.set(resourceKey, lockValue, 'PX', ttlMs, 'NX');

    // 'OK' (ioredis string) or 1 (raw RESP integer) means we acquired the lock.
    if (result === 'OK' || result === 1 || result === true) {
      return lockValue;
    }

    // null / 0 / false means the key already exists — another process holds the lock.
    return null;
  } catch (err) {
    logger.error({ err }, '[RedisLock] Error acquiring lock for key', resourceKey);
    // Re-throw as a typed error so callers can distinguish Redis failures
    // from "lock is held" (null return).
    throw new LockAcquisitionError(resourceKey, err.message);
  }
}

/**
 * Renews a distributed lock by extending its TTL, but only if the caller
 * still holds it (verified via Lua to prevent TOCTOU races).
 *
 * @param {string} resourceKey
 * @param {string} lockValue   The UUID returned by acquireLock
 * @param {number} ttlMs       New TTL in milliseconds
 * @returns {Promise<boolean>} true if renewed, false if the lock is no longer ours
 */
export async function renewLock(resourceKey, lockValue, ttlMs = 30_000) {
  return (await renewOwned(resourceKey, lockValue, ttlMs)) === 'renewed';
}

/**
 * Tri-state variant of `renewLock` used by the keep-alive loop so it can tell a
 * confirmed ownership loss apart from a transient Redis error:
 *   'renewed' → TTL extended
 *   'lost'    → the key is gone / now holds someone else's token
 *   'error'   → Redis unavailable or the script failed (ownership unknown)
 *
 * @returns {Promise<'renewed'|'lost'|'error'>}
 */
async function renewOwned(resourceKey, lockValue, ttlMs = 30_000) {
  if (!redisClient || !lockValue) return 'error';

  const luaScript = `
    if redis.call('GET', KEYS[1]) == ARGV[1] then
      redis.call('PEXPIRE', KEYS[1], ARGV[2])
      return 1
    end
    return 0
  `;

  try {
    const result = await redisClient.eval(
      luaScript, 1, resourceKey, lockValue, ttlMs.toString()
    );
    return result === 1 ? 'renewed' : 'lost';
  } catch (err) {
    logger.error({ err }, '[RedisLock] Error renewing lock for key', resourceKey);
    return 'error';
  }
}

/**
 * Renews the lock on a fixed interval while a long-running async task holds
 * the critical section, so the lock cannot silently lapse mid-operation (e.g.
 * while awaiting a slow on-chain `waitForConfirmation()`).
 *
 * This is the fix for concurrency issue #14681: per-order escrow locks were
 * acquired with a fixed TTL but never renewed, so a blockchain confirmation
 * that outlived the TTL let a second sweep re-lock and double-submit a payout.
 *
 * The renewal runs on `intervalMs` (default 10 s, always clamped to be shorter
 * than `ttlMs`). Each renewal only succeeds if we still own the lock; if the
 * lock is lost the timer keeps firing harmlessly (renewLock returns false) and
 * the task itself must detect the lost lock. The timer is always cleared in a
 * `finally` so it never outlives the task.
 *
 * @param {string}      resourceKey
 * @param {string|null} lockValue   The UUID returned by acquireLock; if falsy, no renewal (pass-through)
 * @param {number}      ttlMs       TTL to extend to on each renewal
 * @param {() => Promise<T>} asyncFn  The critical-section task
 * @param {number}      [intervalMs] Renewal cadence (default 10 000 ms)
 * @returns {Promise<T>} the task's result
 * @template T
 */
export const DEFAULT_LOCK_RENEWAL_INTERVAL_MS = 10_000;

export async function withLockRenewal(resourceKey, lockValue, ttlMs, asyncFn, intervalMs = DEFAULT_LOCK_RENEWAL_INTERVAL_MS) {
  if (!resourceKey || !lockValue || typeof asyncFn !== 'function') {
    return asyncFn();
  }

  // Never renew less often than half the TTL, so at least one renewal lands
  // before the lock could expire even if a tick is delayed.
  const renewalIntervalMs = Math.max(Math.min(intervalMs, Math.floor(ttlMs / 2)), 1_000);

  const timer = setInterval(() => {
    // Fire-and-forget: renewLock logs and returns false on failure; a missed
    // tick does not abort the task, it only risks the lock lapsing.
    void renewLock(resourceKey, lockValue, ttlMs);
  }, renewalIntervalMs);
  // Don't keep the event loop alive solely for lock renewal.
  timer.unref?.();

  try {
    return await asyncFn();
  } finally {
    clearInterval(timer);
  }
}

/**
 * Releases a distributed lock **only if** we still own it.
 *
 * Uses an atomic Lua script (GET + DEL) so a slow holder cannot accidentally
 * delete a newer holder's lock after its own TTL has expired.
 *
 * Safe to call in a `finally` block — never throws; returns false on failure
 * so the caller can log a warning if needed.
 *
 * @param {string}      resourceKey  The same key passed to acquireLock
 * @param {string|null} lockValue    The UUID returned by acquireLock; if null/undefined, no-op
 * @returns {Promise<boolean>} true if we held and deleted the lock, false otherwise
 */
export async function releaseLock(resourceKey, lockValue) {
  if (!redisClient || !lockValue) return false;

  const luaScript = `
    if redis.call('GET', KEYS[1]) == ARGV[1] then
      redis.call('DEL', KEYS[1])
      return 1
    end
    return 0
  `;

  try {
    const result = await redisClient.eval(luaScript, 1, resourceKey, lockValue);
    return result === 1;
  } catch (err) {
    logger.error({ err }, '[RedisLock] Error releasing lock for key', resourceKey);
    return false;
  }
}

// === Spec 15: ===
// === Spec 15: fix double-release in Redis distributed lock ===
export class LockState {
  constructor() { this.released = false; this.held = false; }
  acquire() { if (this.held) return false; this.held = true; return true; }
  release() {
    if (this.released || !this.held) { this.released = true; return false; }
    this.held = false; this.released = true; return true;
  }
  isHeld() { return this.held && !this.released; }
}

// Legacy CommonJS RedisLock class removed — it used require('redis')
// which is invalid in this ES module context (package.json has
// "type": "module") and caused a ReferenceError at module load time.
// Use the ESM acquireDistributedLock / releaseDistributedLock exports above.
