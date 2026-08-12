/**
 * Unit tests for backend/api/src/lib/requestCache.js
 *
 * Run with:  npm run test:unit -- test/unit/requestCache.test.js
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { RequestCache } from '../../src/lib/requestCache.js';

describe('RequestCache', () => {
  let cache;

  beforeEach(() => {
    cache = new RequestCache();
  });

  describe('constructor', () => {
    it('initializes with an empty Map', () => {
      expect(cache.size).toBe(0);
    });
  });

  describe('set', () => {
    it('stores a value by key and returns the cache instance for chaining', () => {
      const result = cache.set('key1', 'value1');
      expect(result).toBe(cache); // set() returns `this`
      expect(cache.get('key1')).toBe('value1');
    });

    it('overwrites an existing key', () => {
      cache.set('key1', 'value1');
      cache.set('key1', 'value2');
      expect(cache.get('key1')).toBe('value2');
      expect(cache.size).toBe(1);
    });

    it('stores different value types', () => {
      cache.set('string', 'hello');
      cache.set('number', 42);
      cache.set('object', { foo: 'bar' });
      cache.set('array', [1, 2, 3]);
      cache.set('null', null);
      cache.set('undefined', undefined);

      expect(cache.get('string')).toBe('hello');
      expect(cache.get('number')).toBe(42);
      expect(cache.get('object')).toEqual({ foo: 'bar' });
      expect(cache.get('array')).toEqual([1, 2, 3]);
      expect(cache.get('null')).toBe(null);
      expect(cache.get('undefined')).toBe(undefined);
    });
  });

  describe('get', () => {
    it('returns undefined for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBe(undefined);
    });

    it('returns the stored value for existing keys', () => {
      cache.set('key', { nested: { value: 42 } });
      expect(cache.get('key')).toEqual({ nested: { value: 42 } });
    });
  });

  describe('has', () => {
    it('returns false for non-existent keys', () => {
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('returns true for existing keys', () => {
      cache.set('present', true);
      expect(cache.has('present')).toBe(true);
    });

    it('returns false after delete (via clear)', () => {
      cache.set('temp', 1);
      expect(cache.has('temp')).toBe(true);
      cache.clear();
      expect(cache.has('temp')).toBe(false);
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      expect(cache.size).toBe(3);

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.get('a')).toBe(undefined);
      expect(cache.get('b')).toBe(undefined);
      expect(cache.get('c')).toBe(undefined);
    });

    it('can be called on an empty cache without error', () => {
      expect(() => cache.clear()).not.toThrow();
    });
  });

  describe('size', () => {
    it('reflects the number of entries', () => {
      expect(cache.size).toBe(0);
      cache.set('a', 1);
      expect(cache.size).toBe(1);
      cache.set('b', 2);
      expect(cache.size).toBe(2);
      cache.set('c', 3);
      expect(cache.size).toBe(3);
    });

    it('decreases when entries are cleared', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.clear();
      expect(cache.size).toBe(0);
    });
  });
});
