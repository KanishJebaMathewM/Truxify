import { describe, it, expect, beforeEach } from 'vitest';
import { LRUCache } from '../../../src/lib/lruCache.js';

describe('LRUCache (lib)', () => {
  let cache;

  beforeEach(() => {
    cache = new LRUCache(3);
  });

  it('stores and retrieves values', () => {
    cache.set('key', 'value');
    expect(cache.get('key')).toBe('value');
  });

  it('returns undefined for missing keys', () => {
    expect(cache.get('missing')).toBeUndefined();
  });

  it('evicts least recently used when over capacity', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4);
    expect(cache.get('a')).toBeUndefined();
  });

  it('updates existing key without eviction', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10); // refresh 'a'
    cache.set('c', 3);
    cache.set('d', 4);
    expect(cache.get('a')).toBe(10);
    expect(cache.get('b')).toBeUndefined(); // 'b' was LRU
  });

  it('has clear method', () => {
    cache.set('a', 1);
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
  });
});
