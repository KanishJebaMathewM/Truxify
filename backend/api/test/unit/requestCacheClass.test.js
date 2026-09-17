import { describe, it, expect } from 'vitest';
import { RequestCache } from '../../src/lib/requestCache.js';

describe('RequestCache', () => {
  it('starts empty', () => {
    const cache = new RequestCache();
    expect(cache.size).toBe(0);
  });

  it('stores and retrieves a value', () => {
    const cache = new RequestCache();
    cache.set('order:1', { id: 'o1' });
    expect(cache.get('order:1')).toEqual({ id: 'o1' });
  });

  it('returns undefined for a missing key', () => {
    const cache = new RequestCache();
    expect(cache.get('missing')).toBeUndefined();
  });

  it('set returns the cache for chaining', () => {
    const cache = new RequestCache();
    expect(cache.set('a', 1)).toBe(cache);
  });

  it('has reports key presence', () => {
    const cache = new RequestCache();
    expect(cache.has('a')).toBe(false);
    cache.set('a', 1);
    expect(cache.has('a')).toBe(true);
  });

  it('overwrites an existing key', () => {
    const cache = new RequestCache();
    cache.set('a', 1);
    cache.set('a', 2);
    expect(cache.get('a')).toBe(2);
    expect(cache.size).toBe(1);
  });

  it('clear removes every key', () => {
    const cache = new RequestCache();
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });

  it('tracks size as keys are added', () => {
    const cache = new RequestCache();
    cache.set('a', 1).set('b', 2).set('c', 3);
    expect(cache.size).toBe(3);
  });
});
