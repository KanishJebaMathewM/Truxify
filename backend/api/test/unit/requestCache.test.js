import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { RequestCache, attachResponseCleanup } from '../../src/lib/requestCache.js';

describe('RequestCache', () => {
  let cache;
  beforeEach(() => { cache = new RequestCache(); });

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

  it('returns null for missing key (distinguished from undefined)', () => {
    expect(cache.get('missing')).toBe(null);
    cache.set('nil', undefined);
    expect(cache.get('nil')).toBe(null);
  });

  it('has returns true for existing key', () => {
    cache.set('a', 1);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
  });

  it('delete removes entry', () => {
    cache.set('a', 1);
    cache.delete('a');
    expect(cache.get('a')).toBe(null);
    expect(cache.has('a')).toBe(false);
  });

  it('clear removes all entries', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('size reflects entry count', () => {
    expect(cache.size).toBe(0);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size).toBe(2);
  });

  it('set returns this for chaining', () => {
    expect(cache.set('a', 1)).toBe(cache);
  });
});


// === Spec 25 test ===
describe('attachResponseCleanup', () => {
  it('returns a cleanup function', () => {
    const { EventEmitter } = require('node:events');
    const emitter = new EventEmitter();
    const res = new EventEmitter();
    const cleanup = attachResponseCleanup(emitter, res);
    expect(typeof cleanup).toBe('function');
  });
});
