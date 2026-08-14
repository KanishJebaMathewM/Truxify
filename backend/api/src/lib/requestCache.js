const MISSING = Symbol('RequestCache:missing');
export class RequestCache {
  constructor() {
    this._cache = new Map();
  }

  /**
   * Returns the cached value for key, or null if not found.
   * Unlike Map.get(), this distinguishes cache misses (returns null) from
   * stored undefined values (returns undefined from the cache).
   */
  get(key) {
    const val = this._cache.get(key);
    return val === MISSING ? null : val ?? null;
  }

  set(key, value) {
    // Store MISSING sentinel for null values so they are preserved in the cache
    this._cache.set(key, value ?? MISSING);
    return this;
  }

  has(key) {
    return this._cache.has(key);
  }

  delete(key) {
    return this._cache.delete(key);
  }

  clear() {
    this._cache.clear();
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

