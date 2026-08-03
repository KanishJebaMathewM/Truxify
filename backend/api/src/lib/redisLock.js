import crypto from 'crypto';
import { redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';

/**
 * Thrown when a distributed lock cannot be acquired.
 * Callers should catch this and abort the protected operation.
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
 * Acquires a distributed lock using Redis.
 * @param {string} resourceKey - The unique key identifying the resource to lock (e.g. `escrow_lock:123`)
 * @param {number} ttlMs - Time to live in milliseconds
 * @returns {Promise<string|null>} lockValue if acquired, null if the lock is held by another process
 * @throws {LockAcquisitionError} when the lock cannot be acquired due to Redis being unavailable,
 *  so callers fail closed instead of proceeding without mutual exclusion
 */
export async function acquireLock(resourceKey, ttlMs = 10000) {
  if (!redisClient) {
    throw new LockAcquisitionError(resourceKey, 'redisClient is not available');
  }

  const lockValue = crypto.randomUUID();
  try {
    const acquired = await redisClient.set(resourceKey, lockValue, 'PX', ttlMs, 'NX');
    if (acquired === 'OK' || acquired === 1 || acquired === true) {
      return lockValue;
    }
    return null;
  } catch (err) {
    logger.error({ err }, '[RedisLock] Error acquiring lock for key', resourceKey);
    throw new LockAcquisitionError(resourceKey, err.message);
  }
}

/**
 * Renews a distributed lock by extending its TTL if still held by this lockValue.
 * @param {string} resourceKey - The unique key identifying the resource
 * @param {string} lockValue - The value returned by acquireLock
 * @param {number} ttlMs - New TTL in milliseconds
 * @returns {Promise<boolean>} true if renewed, false otherwise
 */
export async function renewLock(resourceKey, lockValue, ttlMs = 10000) {
  if (!redisClient || !lockValue) return false;

  const luaScript = `
    if redis.call('GET', KEYS[1]) == ARGV[1] then
      redis.call('PEXPIRE', KEYS[1], ARGV[2])
      return 1
    end
    return 0
  `;

  try {
    const result = await redisClient.eval(luaScript, 1, resourceKey, lockValue, ttlMs.toString());
    return result === 1;
  } catch (err) {
    logger.error({ err }, '[RedisLock] Error renewing lock for key', resourceKey);
    return false;
  }
}

/**
 * Releases a distributed lock using a Lua script to ensure atomicity.
 * @param {string} resourceKey - The unique key identifying the resource
 * @param {string} lockValue - The value returned by acquireLock
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