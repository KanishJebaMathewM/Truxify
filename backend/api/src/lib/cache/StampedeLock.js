import { acquireDistributedLock } from '../redisLock.js';
import logger from '../../middleware/logger.js';

/**
 * StampedeLock: Distributed Mutex & Single-Flight Coalescer
 * 
 * Prevents multiple concurrent processes or requests from executing the same
 * expensive compute function (cache stampede / dogpiling) simultaneously.
 * 
 * Features:
 * 1. Single-Flight Coalescing: In-process duplicate requests join an existing in-flight Promise.
 * 2. Distributed Mutex: Inter-process coordination across instances using Redis SET NX EX locks.
 * 3. Graceful Fallback: Local mutex fallback if Redis is down or unavailable.
 */
export class StampedeLock {
  constructor(options = {}) {
    this.lockPrefix = options.lockPrefix || 'lock:cache:stampede:';
    this.defaultTtlSeconds = options.defaultTtlSeconds || 10;
    this.inFlight = new Map(); // Map<string, Promise<any>>
  }

  /**
   * Executes a compute function under single-flight and distributed lock protection.
   * 
   * @param {string} key - Unique cache key to protect
   * @param {Function} computeFn - Async function computing the new value
   * @param {object} [options={}] - Lock options (ttlSeconds, waitTimeoutMs)
   * @returns {Promise<{value: any, isLeader: boolean, durationMs: number}>}
   */
  async execute(key, computeFn, options = {}) {
    const lockKey = `${this.lockPrefix}${key}`;
    const ttlSeconds = options.ttlSeconds || this.defaultTtlSeconds;

    // 1. Single-flight within the same Node.js process: coalesce concurrent callers
    if (this.inFlight.has(key)) {
      try {
        const result = await this.inFlight.get(key);
        return { value: result.value, isLeader: false, durationMs: result.durationMs };
      } catch (err) {
        // If the in-flight computation failed, fall through to attempt computation ourselves
      }
    }

    // 2. Create the in-flight deferred promise
    const computePromise = (async () => {
      let lock = null;
      try {
        lock = await acquireDistributedLock(lockKey, ttlSeconds);

        if (!lock.acquired) {
          // Lock held by another instance.
          // Wait briefly for the leader to finish updating the cache
          const waitTimeoutMs = options.waitTimeoutMs || 250;
          await new Promise((resolve) => setTimeout(resolve, waitTimeoutMs));
          return { value: null, isLeader: false, durationMs: 0, lockContended: true };
        }

        const start = Date.now();
        const value = await computeFn();
        const durationMs = Date.now() - start;

        return { value, isLeader: true, durationMs, lockContended: false };
      } catch (err) {
        logger.error({ err, key }, '[StampedeLock] Error executing compute function');
        throw err;
      } finally {
        if (lock && typeof lock.release === 'function') {
          try {
            await lock.release();
          } catch (releaseErr) {
            logger.warn({ err: releaseErr, key }, '[StampedeLock] Failed releasing distributed lock');
          }
        }
      }
    })();

    this.inFlight.set(key, computePromise);

    try {
      return await computePromise;
    } finally {
      this.inFlight.delete(key);
    }
  }

  /**
   * Clears any active in-flight maps (useful for teardown/cleanup).
   */
  clear() {
    this.inFlight.clear();
  }
}

export default StampedeLock;
