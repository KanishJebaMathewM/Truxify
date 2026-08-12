import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LRUCache } from '../../src/utils/cache.js';

describe('LRUCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws when capacity is not positive', () => {
    expect(() => new LRUCache(0)).toThrow(/Capacity/);
    expect(() => new LRUCache(-1)).toThrow(/Capacity/);
  });

  it('stores and retrieves a value', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
  });

  it('returns undefined for a missing key', () => {
    const cache = new LRUCache(2);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('evicts the least recently used entry when over capacity', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('refreshes LRU order on get', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // a becomes most recently used
    cache.set('c', 3);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  it('expires entries after the default TTL', () => {
    const cache = new LRUCache(2, 1000);
    cache.set('a', 1);
    vi.advanceTimersByTime(1001);
    expect(cache.get('a')).toBeUndefined();
  });

  it('honours a per-set TTL override', () => {
    const cache = new LRUCache(2, 1000);
    cache.set('a', 1, 5000);
    vi.advanceTimersByTime(2000);
    expect(cache.get('a')).toBe(1);
    vi.advanceTimersByTime(4000);
    expect(cache.get('a')).toBeUndefined();
  });

  it('invalidates a specific key', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.invalidate('a');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
  });

  it('clears the whole cache', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });
});
