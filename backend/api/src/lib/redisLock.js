import { redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';
import crypto from 'crypto';

const localQueues = new Map();

function acquireLocalLock(key, ttlSeconds) {
  const tail = localQueues.get(key) ?? Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const chain = tail.then(() => gate);
  localQueues.set(key, chain);

  let released = false;
  const doRelease = () => {
    if (released) return;
    released = true;
    release();
    chain.then(() => {
      if (localQueues.get(key) === chain) {
        localQueues.delete(key);
      }
    });
  };

  const timer = setTimeout(doRelease, ttlSeconds * 1000);
  timer.unref?.();

  return tail.then(() => ({
    acquired: true,
    release: async () => {
      clearTimeout(timer);
      doRelease();
    },
  }));
}

/**
 * Acquires a distributed lock using Redis SET NX EX.
 * Falls back to an in-process per-key mutex when Redis is unavailable.
 * 
 * @param {string} key - The unique lock identifier (e.g., lock:profile:uid).
 * @param {number} ttlSeconds - Time-to-live to prevent deadlocks if the process crashes.
 * @returns {Promise<{acquired: boolean, release: Function}>}
 */
export async function acquireDistributedLock(key, ttlSeconds = 5) {
  const isRedisReady = redisClient &&
    (redisClient.status === 'ready' || (!redisClient.status && typeof redisClient.set === 'function'));

  if (!isRedisReady) {
    // Degraded / fallback mode: maintain in-process mutual exclusion per key
    return acquireLocalLock(key, ttlSeconds);
  }

  try {
    const lock = await redisClient.set(key, '1', 'NX', 'EX', ttlSeconds);
    if (lock === 'OK') {
      return {
        acquired: true,
        release: async () => {
          try {
            await redisClient.del(key);
          } catch (err) {
            logger.error({ err, key }, 'Failed to release distributed lock');
          }
        }
      };
    }
  } catch (err) {
    logger.error({ err, key }, 'Redis lock acquisition error; using local mutex fallback');
    return acquireLocalLock(key, ttlSeconds);
  }

  return { acquired: false, release: async () => {} };
}

/**
 * Releases a distributed lock acquired via acquireDistributedLock by key.
 * Removes from Redis and clears any local fallback queue entry.
 *
 * @param {string} key - Lock key
 */
export async function releaseDistributedLock(key) {
  if (redisClient && typeof redisClient.del === 'function') {
    try {
      await redisClient.del(key);
    } catch (err) {
      logger.error({ err, key }, 'Failed to release distributed lock');
    }
  }
  if (localQueues.has(key)) {
    localQueues.delete(key);
  }
}

/**
 * Executes a function with a distributed lock, retrying if the lock is held.
 * 
 * @param {string} key - Lock key
 * @param {Function} fn - Async function to execute
 * @param {object} options - Retry configuration
 */
export async function withLock(key, fn, options = {}) {
  const { ttlSeconds = 5, retryDelayMs = 100, maxRetries = 3 } = options;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const lock = await acquireDistributedLock(key, ttlSeconds);
    
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
 * by returning HTTP 503 Service Unavailable. This is a hard failure,
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

    if (result === 'OK' || result === 1 || result === true) {
      return lockValue;
    }

    return null;
  } catch (err) {
    logger.error({ err }, '[RedisLock] Error acquiring lock for key', resourceKey);
    throw new LockAcquisitionError(resourceKey, err?.message ?? String(err));
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
  if (!redisClient || !lockValue) return false;

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
    return result === 1;
  } catch (err) {
    logger.error({ err }, '[RedisLock] Error renewing lock for key', resourceKey);
    return false;
  }
}

export const DEFAULT_LOCK_RENEWAL_INTERVAL_MS = 10_000;

export async function withLockRenewal(resourceKey, lockValue, ttlMs, asyncFn, intervalMs = DEFAULT_LOCK_RENEWAL_INTERVAL_MS) {
  if (!resourceKey || !lockValue || typeof asyncFn !== 'function') {
    return asyncFn();
  }

  const renewalIntervalMs = Math.max(Math.min(intervalMs, Math.floor(ttlMs / 2)), 1_000);

  // AbortController lets us signal the protected operation to stop if the lock
  // is lost mid-execution (renewal returns false = another holder now owns it).
  const ac = new AbortController();
  const { signal } = ac;

  const timer = setInterval(async () => {
    const renewed = await renewLock(resourceKey, lockValue, ttlMs);
    if (!renewed) {
      // Lock ownership lost — stop the renewal loop and abort the operation.
      clearInterval(timer);
      logger.error(
        { resourceKey },
        '[RedisLock] Lock renewal failed: ownership lost. Aborting protected operation.'
      );
      ac.abort();
    }
  }, renewalIntervalMs);
  timer.unref?.();

  try {
    const result = await asyncFn(signal);
    // If the lock was lost after asyncFn resolved, surface it before returning.
    if (signal.aborted) {
      throw new LockAcquisitionError(
        resourceKey,
        'Lock ownership was lost during execution \u2014 protected operation aborted'
      );
    }
    return result;
  } catch (err) {
    if (signal.aborted && !(err instanceof LockAcquisitionError)) {
      // Wrap the raw AbortError in a domain-specific error.
      throw new LockAcquisitionError(
        resourceKey,
        'Lock ownership was lost during execution \u2014 protected operation aborted'
      );
    }
    throw err;
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
 * Safe to call in a `finally` block — never throws; returns false on failure.
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

export class LockState {
  constructor() { this.released = false; this.held = false; }
  acquire() { if (this.held) return false; this.held = true; return true; }
  release() {
    if (this.released || !this.held) { this.released = true; return false; }
    this.held = false; this.released = true; return true;
  }
  isHeld() { return this.held && !this.released; }
}
