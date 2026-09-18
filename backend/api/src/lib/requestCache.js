import logger from '../middleware/logger.js';

const MISSING = Symbol('RequestCache:missing');
const TTL_WRAPPER = Symbol('RequestCache:ttl');

export class RequestCache {
  constructor() {
    this._cache = new Map();
    this._errorCount = 0;
  }

  /**
   * Returns the cached value for key, or null if not found.
   * Unlike Map.get(), this distinguishes cache misses (returns null) from
   * stored undefined values (returns undefined from the cache).
   */
  get(key) {
    const entry = this._cache.get(key);
    if (entry === undefined) return null;
    if (entry && typeof entry === 'object' && entry[TTL_WRAPPER]) {
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        this._cache.delete(key);
        return null;
      }
      return entry.value === MISSING ? null : entry.value ?? null;
    }
    return entry === MISSING ? null : entry ?? null;
  }

  set(key, value, ttlOrOptions) {
    let ttlMs = null;
    if (typeof ttlOrOptions === 'number' && Number.isFinite(ttlOrOptions) && ttlOrOptions > 0) {
      ttlMs = ttlOrOptions;
    } else if (ttlOrOptions && typeof ttlOrOptions === 'object') {
      const optTtl = ttlOrOptions.ttl ?? ttlOrOptions.ttlMs;
      if (typeof optTtl === 'number' && Number.isFinite(optTtl) && optTtl > 0) {
        ttlMs = optTtl;
      }
    }

    const valToStore = value ?? MISSING;
    if (ttlMs !== null) {
      this._cache.set(key, {
        [TTL_WRAPPER]: true,
        value: valToStore,
        expiresAt: Date.now() + ttlMs,
      });
    } else {
      this._cache.set(key, valToStore);
    }
    return this;
  }

  has(key) {
    if (!this._cache.has(key)) return false;
    const entry = this._cache.get(key);
    if (entry && typeof entry === 'object' && entry[TTL_WRAPPER]) {
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        this._cache.delete(key);
        return false;
      }
    }
    return true;
  }

  delete(key) {
    return this._cache.delete(key);
  }

  clear() {
    this._cache.clear();
  }

  setBatch(entries) {
    // entries is an array of {key, value, ttl} objects
    if (!Array.isArray(entries)) return;
    for (const item of entries) {
      if (!item || typeof item !== 'object') continue;
      const { key, value, ttl, ttlMs } = item;
      try {
        this.set(key, value, ttl ?? ttlMs);
      } catch (err) {
        logger.error({ event: 'REQUEST_CACHE_SET_ERROR', key }, '[RequestCache] setBatch failed for key');
        this._errorCount = (this._errorCount || 0) + 1;
      }
    }
  }

  get size() {
    return this._cache.size;
  }
}


// === Spec 25: ===
// === Spec 25: event listener leak guard ===
export function attachResponseCleanup(emitter, res, eventName = 'data') {
  const onData = () => {};
  emitter.on(eventName, onData);
  const cleanup = () => {
    emitter.removeListener(eventName, onData);
    res.removeListener('finish', cleanup);
    res.removeListener('close', cleanup);
  };
  res.on('finish', cleanup);
  res.on('close', cleanup);
  return cleanup;
}

