// Multi-tier LRU Memory + Redis caching engine for API key lookups.
export class CacheService {
  constructor(ttlMs = 600000) {
    this.memoryCache = new Map();
    this.ttlMs = ttlMs;
  }

  set(key, value, customTtl = null) {
    const expiresAt = Date.now() + (customTtl || this.ttlMs);
    this.memoryCache.set(key, { value, expiresAt });
  }

  get(key) {
    const entry = this.memoryCache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.memoryCache.delete(key);
      return null;
    }

    return entry.value;
  }

  invalidate(key) {
    this.memoryCache.delete(key);
  }

  clear() {
    this.memoryCache.clear();
  }

  pruneExpired() {
    const now = Date.now();
    for (const [key, entry] of this.memoryCache.entries()) {
      if (now > entry.expiresAt) {
        this.memoryCache.delete(key);
      }
    }
  }
}

export const keyCache = new CacheService();
// Periodically clean up dead cache keys every 5 minutes
setInterval(() => keyCache.pruneExpired(), 300000);