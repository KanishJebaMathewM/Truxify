import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LRUCache } from '../../src/utils/cache.js';

describe('LRU admission with expired entries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it('keeps a live LRU entry when a newer entry has expired', () => {
    const cache = new LRUCache(2);
    cache.set('live', 'prediction', 1000);
    cache.set('expired', 'old prediction', 10);
    vi.setSystemTime(11);
    cache.set('new', 'new prediction', 1000);
    expect(cache.get('live')).toBe('prediction');
    expect(cache.get('expired')).toBeUndefined();
    expect(cache.get('new')).toBe('new prediction');
  });

  it('reclaims multiple expired entries before successive admissions', () => {
    const cache = new LRUCache(3);
    cache.set('live', 'prediction', 1000);
    cache.set('expired-1', 1, 10);
    cache.set('expired-2', 2, 10);
    vi.setSystemTime(11);
    cache.set('new-1', 3);
    cache.set('new-2', 4);
    expect(cache.get('live')).toBe('prediction');
    expect(cache.get('new-1')).toBe(3);
    expect(cache.get('new-2')).toBe(4);
  });

  it('expires an entry at its deadline, including zero TTL', () => {
    const cache = new LRUCache(2);
    cache.set('deadline', 1, 10);
    vi.setSystemTime(10);
    expect(cache.get('deadline')).toBeUndefined();
    cache.set('zero', 2, 0);
    expect(cache.get('zero')).toBeUndefined();
  });

  it('still evicts the live LRU entry when no space can be reclaimed', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });
});
