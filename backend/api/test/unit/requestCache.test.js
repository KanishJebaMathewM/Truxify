import { describe, it, expect } from 'vitest';
import { RequestCache } from '../../src/lib/requestCache.js';

describe('RequestCache', () => {
  let cache;

  beforeEach(() => {
    cache = new RequestCache();
  });

  it('starts empty', () => {
    expect(cache.size).toBe(0);
    expect(cache.has('key')).toBe(false);
    // get() returns null for cache misses (not undefined), distinguishing
    // missing keys from stored null/undefined values.
    expect(cache.get('key')).toBeNull();
  });

  it('set and get return the value', () => {
    cache.set('key', 'value');
    expect(cache.get('key')).toBe('value');
  });

  it('set returns this for chaining', () => {
    const result = cache.set('key', 'value');
    expect(result).toBe(cache);
  });

  it('has returns true after set', () => {
    cache.set('key', 'value');
    expect(cache.has('key')).toBe(true);
  });

  it('has returns false after delete via clear', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(false);
  });

  it('size tracks number of entries', () => {
    expect(cache.size).toBe(0);
    cache.set('a', 1);
    expect(cache.size).toBe(1);
    cache.set('b', 2);
    expect(cache.size).toBe(2);
    cache.set('a', 3);
    expect(cache.size).toBe(2); // same key, not incremented
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('overwrites existing key', () => {
    cache.set('key', 'v1');
    cache.set('key', 'v2');
    expect(cache.get('key')).toBe('v2');
    expect(cache.size).toBe(1);
  });
});


// === Spec 25 test ===
import { EventEmitter } from 'node:events';
import { attachResponseCleanup } from '../../src/lib/requestCache.js';
describe('attachResponseCleanup', () => {
  it('removes on finish', () => {
    const em = new EventEmitter();
    const res = new EventEmitter();
    attachResponseCleanup(em, res, 'data');
    expect(em.listenerCount('data')).toBe(1);
    res.emit('finish');
    expect(em.listenerCount('data')).toBe(0);
  });
});

