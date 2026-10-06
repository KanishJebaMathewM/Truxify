import crypto from 'crypto';
import { redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';

const localQueues = new Map();

function normalizeTtl(ttlMs, fallbackMs) {
  const value = Number(ttlMs);
  if (!Number.isFinite(value) || value <= 0) {
    return fallbackMs;
  }
  return value;
}

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
  const safeTtlSeconds = normalizeTtl(ttlSeconds, 5);
  const isRedisReady = redisClient &&
    (redisClient.status === 'ready' || (!redisClient.status && typeof redisClient.set === 'function'));

  if (!isRedisReady) {
    return { acquired: false, release: async () => {} };
  }

  try {
    const lock = await redisClient.set(key, '1', 'NX', 'EX', safeTtlSeconds);
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
    return acquireLocalLock(key, safeTtlSeconds);
  }

  return { acquired: false, release: async () => {} };
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
 * @param {string} resourceKey  Unique key for the guarded resource
 * @param {number} ttlMs        Lock TTL in milliseconds (default 30 000 ms)
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

  const safeTtlMs = normalizeTtl(ttlMs, 30_000);
  const lockValue = crypto.randomUUID();

  try {
    const result = await redisClient.set(resourceKey, lockValue, 'PX', safeTtlMs, 'NX');

    if (result === 'OK' || result === 1 || result === true) {
      return lockValue;
    }

    return null;
  } catch (err) {
    logger.error({ err }, '[RedisLock] Error acquiring lock for key', resourceKey);
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
  if (!redisClient || !lockValue || typeof resourceKey !== 'string' || !resourceKey.trim()) return false;

  const safeTtlMs = normalizeTtl(ttlMs, 30_000);
  const luaScript = `
    if redis.call('GET', KEYS[1]) == ARGV[1] then
      redis.call('PEXPIRE', KEYS[1], ARGV[2])
      return 1
    end
    return 0
  `;

  try {
    const result = await redisClient.eval(
      luaScript, 1, resourceKey, lockValue, safeTtlMs.toString()
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
    if (typeof asyncFn === 'function') {
      return asyncFn();
    }
    return undefined;
  }

  const safeTtlMs = normalizeTtl(ttlMs, DEFAULT_LOCK_RENEWAL_INTERVAL_MS * 2);
  const safeIntervalMs = normalizeTtl(intervalMs, DEFAULT_LOCK_RENEWAL_INTERVAL_MS);
  const renewalIntervalMs = Math.max(Math.min(safeIntervalMs, Math.floor(safeTtlMs / 2)), 1_000);

  const timer = setInterval(() => {
    void renewLock(resourceKey, lockValue, safeTtlMs);
  }, renewalIntervalMs);
  timer.unref?.();

  try {
    return await asyncFn();
  } finally {
    clearInterval(timer);
  }
}

/**
 * Releases a distributed lock only if we still own it.
 *
 * @param {string}      resourceKey  The same key passed to acquireLock
 * @param {string|null} lockValue    The UUID returned by acquireLock
 * @returns {Promise<boolean>} true if we held and deleted the lock, false otherwise
 */
export async function releaseLock(resourceKey, lockValue) {
  if (!redisClient || !lockValue || typeof resourceKey !== 'string' || !resourceKey.trim()) return false;

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

let createClient;
try {
  createClient = require('redis').createClient;
} catch {
  createClient = () => ({
    isOpen: false,
    on: () => {},
    connect: async () => {},
    disconnect: async () => {},
    eval: async () => 1,
    get: async () => null,
    set: async () => 'OK',
  });
}

class RedisLock {
  constructor(options = {}) {
    this.redisUrl = options.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';
    this.client = createClient({ url: this.redisUrl });
    this.defaultTtl = options.defaultTtl || 30000;
    this.retryDelay = options.retryDelay || 100;
    this.maxRetries = options.maxRetries || 50;

    this.client.on('error', (err) => {
      console.error('Redis Lock Client Error:', err);
    });

    this.acquireScript = `
      if redis.call("set", KEYS[1], ARGV[1], "NX", "PX", ARGV[2]) then
        return 1
      else
        return 0
      end
    `;

    this.releaseScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
  }

  async connect() {
    if (!this.client) {
      logger.warn('[RedisLock] Client not initialized, skipping connect');
      return;
    }
    if (!this.client.isOpen) {
      await this.client.connect();
    }
  }

  async disconnect() {
    if (!this.client) return;
    if (this.client.isOpen) {
      await this.client.disconnect();
    }
  }

  async acquire(lockName, owner, ttl = this.defaultTtl) {
    if (!this.client) {
      return {
        success: false,
        lockKey: `lock:${lockName}`,
        owner,
        message: 'Redis client not initialized',
      };
    }
    await this.connect();

    const lockKey = `lock:${lockName}`;
    let attempts = 0;

    while (attempts < this.maxRetries) {
      const result = await this.client.eval(this.acquireScript, {
        keys: [lockKey],
        arguments: [owner, ttl.toString()],
      });

      if (result === 1) {
        return {
          success: true,
          lockKey,
          owner,
          ttl,
        };
      }

      attempts++;
      await this.sleep(this.retryDelay);
    }

    return {
      success: false,
      lockKey,
      owner,
      message: 'Failed to acquire lock after maximum retries',
    };
  }

  async release(lockName, owner) {
    if (!this.client) {
      return {
        success: false,
        lockKey: `lock:${lockName}`,
        message: 'Redis client not initialized',
      };
    }
    await this.connect();

    const lockKey = `lock:${lockName}`;
    const result = await this.client.eval(this.releaseScript, {
      keys: [lockKey],
      arguments: [owner],
    });

    return {
      success: result === 1,
      lockKey,
      message: result === 1 ? 'Lock released successfully' : 'Lock not owned by caller or already expired',
    };
  }

  async extend(lockName, owner, additionalTtl) {
    if (!this.client) {
      return { success: false, message: 'Redis client not initialized' };
    }
    await this.connect();

    const lockKey = `lock:${lockName}`;
    const currentOwner = await this.client.get(lockKey);

    if (currentOwner === owner) {
      await this.client.set(lockKey, owner, { PX: additionalTtl });
      return { success: true, message: 'Lock extended successfully' };
    }

    return { success: false, message: 'Cannot extend lock: not owned by caller' };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default RedisLock;
