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


import crypto from 'crypto';
