import crypto from 'crypto';
import { redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';

const localQueues = new Map();

/**
 * Acquires an in-process lock for a resource.
 * Used when Redis is unavailable by the legacy distributed-lock API.
 */
function acquireLocalLock(key, ttlSeconds) {
  const tail = localQueues.get(key) ?? Promise.resolve();

  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

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
 *
 * Falls back to an in-process lock when Redis is unavailable.
 *
 * @param {string} key
 * @param {number} ttlSeconds
 * @returns {Promise<{acquired: boolean, release: Function}>}
 */
export async function acquireDistributedLock(key, ttlSeconds = 5) {
  const isRedisReady =
    redisClient &&
    (redisClient.status === 'ready' ||
      (!redisClient.status && typeof redisClient.set === 'function'));

  if (!isRedisReady) {
    return acquireLocalLock(key, ttlSeconds);
  }

  const lockValue = crypto.randomUUID();

  try {
    const result = await redisClient.set(
      key,
      lockValue,
      'NX',
      'EX',
      ttlSeconds
    );

    if (result === 'OK') {
      return {
        acquired: true,
        release: async () => {
          await releaseLock(key, lockValue);
        },
      };
    }
  } catch (err) {
    logger.error(
      { err, key },
      'Redis lock acquisition error; using local mutex fallback'
    );

    return acquireLocalLock(key, ttlSeconds);
  }

  return {
    acquired: false,
    release: async () => {},
  };
}

/**
 * Executes an async function while holding a distributed lock.
 *
 * @param {string} key
 * @param {Function} fn
 * @param {object} options
 */
export async function withLock(key, fn, options = {}) {
  const {
    ttlSeconds = 5,
    retryDelayMs = 100,
    maxRetries = 3,
  } = options;

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
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(
    `Failed to acquire lock for ${key} after ${maxRetries} retries`
  );
}

/**
 * Error raised when a distributed lock cannot be acquired because
 * Redis is unavailable or the acquisition operation fails.
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
 * Acquires a Redis lock with a unique owner token.
 *
 * Returns null when another process holds the lock.
 * Throws LockAcquisitionError when Redis is unavailable or errors.
 *
 * @param {string} resourceKey
 * @param {number} ttlMs
 * @returns {Promise<string|null>}
 */
export async function acquireLock(resourceKey, ttlMs = 30_000) {
  if (!resourceKey || typeof resourceKey !== 'string') {
    throw new LockAcquisitionError(
      resourceKey ?? 'undefined',
      'resourceKey must be a non-empty string'
    );
  }

  if (
    !redisClient ||
    (redisClient.status && redisClient.status !== 'ready')
  ) {
    throw new LockAcquisitionError(
      resourceKey,
      'Redis client is unavailable'
    );
  }

  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new LockAcquisitionError(
      resourceKey,
      'ttlMs must be a positive number'
    );
  }

  const lockValue = crypto.randomUUID();

  try {
    const result = await redisClient.set(
      resourceKey,
      lockValue,
      'PX',
      ttlMs,
      'NX'
    );

    if (result === 'OK' || result === 1 || result === true) {
      return lockValue;
    }

    return null;
  } catch (err) {
    logger.error(
      { err, resourceKey },
      '[RedisLock] Error acquiring lock'
    );

    throw new LockAcquisitionError(resourceKey, err.message);
  }
}

/**
 * Renews a lock only if the caller still owns it.
 *
 * @param {string} resourceKey
 * @param {string} lockValue
 * @param {number} ttlMs
 * @returns {Promise<boolean>}
 */
export async function renewLock(
  resourceKey,
  lockValue,
  ttlMs = 30_000
) {
  if (!redisClient || !resourceKey || !lockValue) {
    return false;
  }

  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    return false;
  }

  const luaScript = `
    if redis.call('GET', KEYS[1]) == ARGV[1] then
      return redis.call('PEXPIRE', KEYS[1], ARGV[2])
    end
    return 0
  `;

  try {
    const result = await redisClient.eval(
      luaScript,
      1,
      resourceKey,
      lockValue,
      String(ttlMs)
    );

    return Number(result) === 1;
  } catch (err) {
    logger.error(
      { err, resourceKey },
      '[RedisLock] Error renewing lock'
    );

    return false;
  }
}

/**
 * Default lock-renewal interval.
 */
export const DEFAULT_LOCK_RENEWAL_INTERVAL_MS = 10_000;

/**
 * Renews a lock while an asynchronous task runs.
 *
 * The renewal interval is always strictly shorter than the TTL.
 * This function clears its timer when the task finishes.
 *
 * @param {string} resourceKey
 * @param {string|null} lockValue
 * @param {number} ttlMs
 * @param {Function} asyncFn
 * @param {number} intervalMs
 * @returns {Promise<*>}
 */
export async function withLockRenewal(
  resourceKey,
  lockValue,
  ttlMs,
  asyncFn,
  intervalMs = DEFAULT_LOCK_RENEWAL_INTERVAL_MS
) {
  if (typeof asyncFn !== 'function') {
    throw new TypeError('asyncFn must be a function');
  }

  if (!resourceKey || !lockValue) {
    return asyncFn();
  }

  if (!Number.isFinite(ttlMs) || ttlMs <= 1) {
    throw new RangeError('ttlMs must be greater than 1 millisecond');
  }

  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError('intervalMs must be a positive number');
  }

  const renewalIntervalMs = Math.min(
    intervalMs,
    Math.max(1, Math.floor(ttlMs / 2))
  );

  const timer = setInterval(() => {
    void renewLock(resourceKey, lockValue, ttlMs);
  }, renewalIntervalMs);

  timer.unref?.();

  try {
    return await asyncFn();
  } finally {
    clearInterval(timer);
  }
}

/**
 * Releases a Redis lock only if the caller still owns it.
 *
 * Uses an atomic Lua script to prevent deleting another owner's lock.
 *
 * @param {string} resourceKey
 * @param {string|null} lockValue
 * @returns {Promise<boolean>}
 */
export async function releaseLock(resourceKey, lockValue) {
  if (!redisClient || !resourceKey || !lockValue) {
    return false;
  }

  const luaScript = `
    if redis.call('GET', KEYS[1]) == ARGV[1] then
      return redis.call('DEL', KEYS[1])
    end
    return 0
  `;

  try {
    const result = await redisClient.eval(
      luaScript,
      1,
      resourceKey,
      lockValue
    );

    return Number(result) === 1;
  } catch (err) {
    logger.error(
      { err, resourceKey },
      '[RedisLock] Error releasing lock'
    );

    return false;
  }
}

/**
 * Tracks the lifecycle of a lock in local state.
 */
export class LockState {
  constructor() {
    this.released = false;
    this.held = false;
  }

  acquire() {
    if (this.held) {
      return false;
    }

    this.released = false;
    this.held = true;

    return true;
  }

  release() {
    if (this.released || !this.held) {
      this.released = true;
      return false;
    }

    this.held = false;
    this.released = true;

    return true;
  }

  isHeld() {
    return this.held && !this.released;
  }
}
