import crypto from 'crypto';
import { redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';

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