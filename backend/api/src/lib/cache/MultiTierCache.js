import { redisClient as defaultRedisClient } from '../../config/db.js';
import logger from '../../middleware/logger.js';
import { clampMaxKeys } from '../lruCache.js';
import { shouldRecompute } from './XFetch.js';
import { StampedeLock } from './StampedeLock.js';
import { CacheMetrics } from './CacheMetrics.js';

/**
 * MultiTierCache: Two-Tier Predictive Cache with Cache Stampede Protection
 * 
 * Hierarchy:
 * - L1: High-speed in-process LRU memory cache
 * - L2: Shared distributed Redis cluster/instance
 * 
 * Features:
 * - XFetch algorithm: Probabilistic early recomputations eliminate stampedes before TTL expiry.
 * - Single-flight + Distributed Mutex (StampedeLock): Guarantees only one worker executes computeFn on cache miss.
 * - Resilient Fallback: Gracefully operates purely on L1 if L2/Redis becomes unreachable.
 */
export class MultiTierCache {
  /**
   * @param {object} [options={}]
   * @param {object} [options.redisClient] - Redis client instance
   * @param {number} [options.l1MaxKeys=1000] - Max keys for L1 in-memory cache
   * @param {number} [options.defaultTtl=300] - Default TTL in seconds (5 mins)
   * @param {number} [options.defaultBeta=1.0] - Default XFetch beta multiplier
   * @param {string} [options.prefix='mtc:'] - Cache key prefix
   */
  constructor(options = {}) {
    this.redis = options.redisClient ?? defaultRedisClient;
    this.l1MaxKeys = clampMaxKeys(options.l1MaxKeys || 1000);
    this.defaultTtl = options.defaultTtl || 300;
    this.defaultBeta = options.defaultBeta ?? 1.0;
    this.prefix = options.prefix || 'mtc:';

    // L1 in-memory storage (Map maintains insertion/access order for simple LRU eviction)
    this.l1 = new Map();

    this.stampedeLock = new StampedeLock({
      lockPrefix: `${this.prefix}lock:`,
      defaultTtlSeconds: 15,
    });

    this.metrics = new CacheMetrics();
  }

  /**
   * Builds the fully qualified cache key.
   * @param {string} key
   * @returns {string}
   */
  _buildKey(key) {
    return key.startsWith(this.prefix) ? key : `${this.prefix}${key}`;
  }

  /**
   * Writes entry into L1 LRU memory.
   * Evicts least recently used items if size exceeds maxKeys.
   * 
   * @param {string} fullKey
   * @param {object} entry
   */
  _setL1(fullKey, entry) {
    if (this.l1.has(fullKey)) {
      this.l1.delete(fullKey);
    } else if (this.l1.size >= this.l1MaxKeys) {
      // Evict oldest entry (first item in Map iterator)
      const oldestKey = this.l1.keys().next().value;
      if (oldestKey) {
        this.l1.delete(oldestKey);
      }
    }
    this.l1.set(fullKey, entry);
  }

  /**
   * Reads and refreshes access order in L1 LRU memory.
   * 
   * @param {string} fullKey
   * @returns {object|null}
   */
  _getL1(fullKey) {
    if (!this.l1.has(fullKey)) {
      return null;
    }
    const entry = this.l1.get(fullKey);
    // Refresh access order (delete and re-insert)
    this.l1.delete(fullKey);
    this.l1.set(fullKey, entry);
    return entry;
  }

  /**
   * Fetches an entry or computes it under distributed stampede protection with XFetch pre-warming.
   * 
   * @param {string} key - Cache key
   * @param {Function} computeFn - Async function to compute the value on miss/refresh
   * @param {object} [options={}] - Options
   * @param {number} [options.ttl] - TTL in seconds
   * @param {number} [options.beta] - XFetch beta factor
   * @returns {Promise<any>}
   */
  async fetch(key, computeFn, options = {}) {
    const fullKey = this._buildKey(key);
    const ttlSeconds = options.ttl || this.defaultTtl;
    const beta = options.beta ?? this.defaultBeta;
    const now = Date.now();

    // 1. Check L1 Memory Cache
    const l1Entry = this._getL1(fullKey);
    if (l1Entry) {
      const isHardExpired = l1Entry.e <= now;
      if (!isHardExpired) {
        this.metrics.recordL1Hit();

        // Check if XFetch indicates background pre-warming should occur
        if (shouldRecompute(l1Entry.e, l1Entry.d, beta, now)) {
          this._triggerBackgroundRecompute(key, computeFn, options);
        }

        return l1Entry.v;
      }
      // Hard expired in L1, remove it
      this.l1.delete(fullKey);
    }
    this.metrics.recordL1Miss();

    // 2. Check L2 Redis Cache
    let l2Entry = null;
    const isRedisReady = this.redis && (this.redis.status === 'ready' || typeof this.redis.get === 'function');

    if (isRedisReady) {
      try {
        const raw = await this.redis.get(fullKey);
        if (raw) {
          l2Entry = JSON.parse(raw);
        }
      } catch (err) {
        this.metrics.recordL2Fallback();
        logger.warn({ err, key: fullKey }, '[MultiTierCache] Redis GET failed, falling back');
      }
    } else {
      this.metrics.recordL2Fallback();
    }

    if (l2Entry) {
      const isHardExpired = l2Entry.e <= now;
      if (!isHardExpired) {
        this.metrics.recordL2Hit();
        // Warm L1 with L2 entry
        this._setL1(fullKey, l2Entry);

        // Check XFetch early recompute
        if (shouldRecompute(l2Entry.e, l2Entry.d, beta, now)) {
          this._triggerBackgroundRecompute(key, computeFn, options);
        }

        return l2Entry.v;
      }
    } else {
      this.metrics.recordL2Miss();
    }

    // 3. Cache Miss: Execute under StampedeLock protection
    return this._computeAndSet(key, computeFn, options);
  }

  /**
   * Executes compute function and persists results to L1 and L2 under stampede protection.
   * 
   * @private
   */
  async _computeAndSet(key, computeFn, options = {}) {
    const fullKey = this._buildKey(key);
    const ttlSeconds = options.ttl || this.defaultTtl;

    const result = await this.stampedeLock.execute(fullKey, computeFn, {
      ttlSeconds: Math.max(10, Math.ceil(ttlSeconds / 2)),
      waitTimeoutMs: 300,
    });

    if (result.isLeader) {
      this.metrics.recordStampedeLockAcquired();
      this.metrics.recordComputeDuration(result.durationMs);

      await this.set(key, result.value, {
        ttl: ttlSeconds,
        deltaMs: result.durationMs,
      });

      return result.value;
    }

    // Lock was contended or shared in-flight
    if (result.value !== null && result.value !== undefined) {
      return result.value;
    }

    this.metrics.recordStampedeLockContended();

    // Re-check L1 and L2 after waiting for lock leader to finish
    const freshL1 = this._getL1(fullKey);
    if (freshL1 && freshL1.e > Date.now()) {
      return freshL1.v;
    }

    if (this.redis && typeof this.redis.get === 'function') {
      try {
        const raw = await this.redis.get(fullKey);
        if (raw) {
          const freshL2 = JSON.parse(raw);
          if (freshL2.e > Date.now()) {
            this._setL1(fullKey, freshL2);
            return freshL2.v;
          }
        }
      } catch (err) {
        logger.warn({ err, key: fullKey }, '[MultiTierCache] Post-contention Redis read error');
      }
    }

    // Emergency compute if leader didn't populate in time
    const start = Date.now();
    const fallbackValue = await computeFn();
    const durationMs = Date.now() - start;
    await this.set(key, fallbackValue, { ttl: ttlSeconds, deltaMs: durationMs });
    return fallbackValue;
  }

  /**
   * Triggers asynchronous background recomputation to refresh hot cache keys without blocking the request.
   * 
   * @private
   */
  _triggerBackgroundRecompute(key, computeFn, options) {
    this.metrics.recordXFetchPrewarm();
    // Non-blocking invocation
    setImmediate(() => {
      this._computeAndSet(key, computeFn, options).catch((err) => {
        logger.error({ err, key }, '[MultiTierCache] Background XFetch recompute failed');
      });
    });
  }

  /**
   * Sets a value in L1 and L2 cache.
   * 
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {object} [options={}] - Options (ttl, deltaMs)
   * @returns {Promise<boolean>}
   */
  async set(key, value, options = {}) {
    if (value === undefined || value === null) {
      return false;
    }

    const fullKey = this._buildKey(key);
    const ttlSeconds = options.ttl || this.defaultTtl;
    const deltaMs = options.deltaMs || 0;
    const expiryTimestampMs = Date.now() + (ttlSeconds * 1000);

    const payload = {
      v: value,
      e: expiryTimestampMs,
      d: deltaMs,
      t: ttlSeconds,
    };

    // 1. Update L1
    this._setL1(fullKey, payload);

    // 2. Update L2 Redis
    if (this.redis && typeof this.redis.set === 'function') {
      try {
        const serialized = JSON.stringify(payload);
        if (ttlSeconds > 0) {
          await this.redis.set(fullKey, serialized, 'EX', ttlSeconds);
        } else {
          await this.redis.set(fullKey, serialized);
        }
      } catch (err) {
        this.metrics.recordError();
        logger.error({ err, key: fullKey }, '[MultiTierCache] Redis SET error');
        return false;
      }
    }

    this.metrics.recordSet();
    return true;
  }

  /**
   * Gets a value directly from L1 or L2 without computing.
   * 
   * @param {string} key
   * @returns {Promise<any|null>}
   */
  async get(key) {
    const fullKey = this._buildKey(key);
    const now = Date.now();

    // Check L1
    const l1Entry = this._getL1(fullKey);
    if (l1Entry) {
      if (l1Entry.e > now) {
        this.metrics.recordL1Hit();
        return l1Entry.v;
      }
      this.l1.delete(fullKey);
    }
    this.metrics.recordL1Miss();

    // Check L2
    if (this.redis && typeof this.redis.get === 'function') {
      try {
        const raw = await this.redis.get(fullKey);
        if (raw) {
          const l2Entry = JSON.parse(raw);
          if (l2Entry.e > now) {
            this.metrics.recordL2Hit();
            this._setL1(fullKey, l2Entry);
            return l2Entry.v;
          }
        }
      } catch (err) {
        this.metrics.recordError();
        logger.error({ err, key: fullKey }, '[MultiTierCache] Direct GET Redis error');
      }
      this.metrics.recordL2Miss();
    }

    return null;
  }

  /**
   * Deletes a key from L1 and L2.
   * 
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async del(key) {
    const fullKey = this._buildKey(key);
    this.l1.delete(fullKey);

    if (this.redis && typeof this.redis.del === 'function') {
      try {
        await this.redis.del(fullKey);
      } catch (err) {
        this.metrics.recordError();
        logger.error({ err, key: fullKey }, '[MultiTierCache] Redis DEL error');
        return false;
      }
    }

    this.metrics.recordDelete();
    return true;
  }

  /**
   * Clears L1 in-memory cache.
   */
  clearL1() {
    this.l1.clear();
  }

  /**
   * Returns a snapshot of metrics and telemetry.
   * @returns {object}
   */
  getMetrics() {
    return this.metrics.getSnapshot();
  }

  /**
   * Resets all collected telemetry metrics.
   */
  resetMetrics() {
    this.metrics.reset();
  }
}

export default MultiTierCache;
