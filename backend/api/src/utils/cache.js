/**
 * A generic Least Recently Used (LRU) Cache implementation with Time-To-Live (TTL) support.
 */
export class LRUCache {
  constructor(capacity, defaultTtlMs = 60000) {
    if (capacity <= 0) throw new Error("Capacity must be greater than 0");
    this.capacity = capacity;
    this.defaultTtlMs = defaultTtlMs;
    this.cache = new Map();
  }

  /**
   * Retrieves an item from the cache.
   * If the item is expired, it is deleted and undefined is returned.
   * If valid, it is marked as most recently used.
   * @param {string} key 
   * @returns {any} The cached value or undefined
   */
  get(key) {
    if (!this.cache.has(key)) {
      return undefined;
    }

    const item = this.cache.get(key);
    
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Refresh insertion order (LRU)
    this.cache.delete(key);
    this.cache.set(key, item);

    return item.value;
  }

  /**
   * Inserts or updates an item in the cache.
   * If capacity is exceeded, the least recently used item is evicted.
   * @param {string} key 
   * @param {any} value 
   * @param {number} ttlMs Optional TTL in milliseconds override
   */
  set(key, value, ttlMs = this.defaultTtlMs) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      // Evict the first item (least recently used)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Manually invalidates a specific cache key.
   * @param {string} key 
   */
  invalidate(key) {
    this.cache.delete(key);
  }

  /**
   * Clears the entire cache.
   */
  clear() {
    this.cache.clear();
  }
}
