import crypto from 'crypto';
import { redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';

/**
 * Acquires a distributed lock using Redis.
 * @param {string} resourceKey - The unique key identifying the resource to lock (e.g. `escrow_lock:123`)
 * @param {number} ttlMs - Time to live in milliseconds
 * @returns {Promise<string|null>} lockValue if acquired, null if failed
 */
export async function acquireLock(resourceKey, ttlMs = 10000) {
  if (!redisClient) {
    logger.warn('[RedisLock] redisClient not available, bypassing lock for', resourceKey);
    return crypto.randomUUID();
  }

  const lockValue = crypto.randomUUID();
  const acquired = await redisClient.set(resourceKey, lockValue, 'PX', ttlMs, 'NX');
  
  if (acquired) {
    return lockValue;
  }
  return null;
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
