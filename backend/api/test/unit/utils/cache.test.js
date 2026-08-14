import { describe, it, expect, beforeEach } from 'vitest';
import { LRUCache } from '../../../src/utils/cache.js';

describe('LRUCache', () => {
  let cache;

  beforeEach(() => {
    cache = new LRUCache(3);
  });

  describe('set and get', () => {
    it('stores and retrieves a value', () => {
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);
    });

    it('returns undefined for missing keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('overwrites existing key', () => {
      cache.set('a', 1);
      cache.set('a', 2);
      expect(cache.get('a')).toBe(2);
    });
  });

  describe('LRU eviction', () => {
    it('evicts least recently used when capacity is exceeded', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('d', 4); // 'a' should be evicted
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });

    it('does not evict if capacity is not exceeded', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBe(2);
    });
  });

  describe('TTL', () => {
    it('returns undefined for expired entries', async () => {
      const shortCache = new LRUCache(3, 10); // 10ms TTL
      shortCache.set('a', 1);
      await new Promise(r => setTimeout(r, 20));
      expect(shortCache.get('a')).toBeUndefined();
    });

    it('respects custom TTL per entry', async () => {
      const shortCache = new LRUCache(3, 10000);
      shortCache.set('a', 1, 10); // 10ms override
      await new Promise(r => setTimeout(r, 20));
      expect(shortCache.get('a')).toBeUndefined();
    });
  });

  describe('invalidate', () => {
    it('removes a specific key', () => {
      cache.set('a', 1);
      cache.invalidate('a');
      expect(cache.get('a')).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.clear();
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBeUndefined();
    });
  });

  describe('constructor', () => {
    it('throws for non-positive capacity', () => {
      expect(() => new LRUCache(0)).toThrow("Capacity must be greater than 0");
      expect(() => new LRUCache(-1)).toThrow("Capacity must be greater than 0");
    });
  });
});
