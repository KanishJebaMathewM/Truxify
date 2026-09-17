import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { RequestCache, attachResponseCleanup } from '../../../src/lib/requestCache.js';

describe('RequestCache Unit Tests', () => {
  let cache;

  beforeEach(() => {
    cache = new RequestCache();
    vi.useRealTimers();
  });

  describe('Cache Hit and Miss', () => {
    it('returns null on cache miss for non-existent key', () => {
      expect(cache.get('non_existent_key')).toBeNull();
      expect(cache.has('non_existent_key')).toBe(false);
    });

    it('returns stored value on cache hit', () => {
      cache.set('user:123', { name: 'Alice', role: 'driver' });
      expect(cache.get('user:123')).toEqual({ name: 'Alice', role: 'driver' });
      expect(cache.has('user:123')).toBe(true);
    });

    it('preserves primitive values accurately on cache hit', () => {
      cache.set('count', 42);
      cache.set('flag', false);
      cache.set('title', 'Truxify');

      expect(cache.get('count')).toBe(42);
      expect(cache.get('flag')).toBe(false);
      expect(cache.get('title')).toBe('Truxify');
    });

    it('handles null and undefined values without treating them as unhandled errors', () => {
      cache.set('null_key', null);
      cache.set('undefined_key', undefined);

      expect(cache.has('null_key')).toBe(true);
      expect(cache.has('undefined_key')).toBe(true);
      expect(cache.get('null_key')).toBeNull();
      expect(cache.get('undefined_key')).toBeNull();
    });

    it('overwrites previous value on duplicate set', () => {
      cache.set('key1', 'initial');
      expect(cache.get('key1')).toBe('initial');

      cache.set('key1', 'updated');
      expect(cache.get('key1')).toBe('updated');
      expect(cache.size).toBe(1);
    });
  });

  describe('TTL Behavior', () => {
    it('returns cached value before TTL expires', () => {
      vi.useFakeTimers();
      cache.set('temp_key', 'temp_value', 1000);

      expect(cache.get('temp_key')).toBe('temp_value');
      expect(cache.has('temp_key')).toBe(true);

      vi.advanceTimersByTime(500);
      expect(cache.get('temp_key')).toBe('temp_value');
      expect(cache.has('temp_key')).toBe(true);
    });

    it('returns null and removes entry after TTL expires on get', () => {
      vi.useFakeTimers();
      cache.set('temp_key', 'temp_value', 1000);

      vi.advanceTimersByTime(1001);
      expect(cache.get('temp_key')).toBeNull();
      expect(cache.has('temp_key')).toBe(false);
    });

    it('has() returns false and removes expired TTL entry', () => {
      vi.useFakeTimers();
      cache.set('temp_key', 'temp_value', 1000);

      vi.advanceTimersByTime(1001);
      expect(cache.has('temp_key')).toBe(false);
      expect(cache.get('temp_key')).toBeNull();
    });

    it('supports TTL specified as options object { ttl: ms } or { ttlMs: ms }', () => {
      vi.useFakeTimers();
      cache.set('opt_ttl', 'value1', { ttl: 2000 });
      cache.set('opt_ttl_ms', 'value2', { ttlMs: 3000 });

      vi.advanceTimersByTime(1000);
      expect(cache.get('opt_ttl')).toBe('value1');
      expect(cache.get('opt_ttl_ms')).toBe('value2');

      vi.advanceTimersByTime(1500);
      expect(cache.get('opt_ttl')).toBeNull();
      expect(cache.get('opt_ttl_ms')).toBe('value2');

      vi.advanceTimersByTime(1000);
      expect(cache.get('opt_ttl_ms')).toBeNull();
    });

    it('handles non-positive or invalid TTL values by falling back to standard cache entry', () => {
      cache.set('invalid_ttl_neg', 'value_neg', -100);
      cache.set('invalid_ttl_zero', 'value_zero', 0);
      cache.set('invalid_ttl_nan', 'value_nan', NaN);

      expect(cache.get('invalid_ttl_neg')).toBe('value_neg');
      expect(cache.get('invalid_ttl_zero')).toBe('value_zero');
      expect(cache.get('invalid_ttl_nan')).toBe('value_nan');
    });
  });

  describe('Delete Operation', () => {
    it('deletes an existing key and returns true', () => {
      cache.set('key_to_delete', 'value');
      expect(cache.has('key_to_delete')).toBe(true);

      const deleted = cache.delete('key_to_delete');
      expect(deleted).toBe(true);
      expect(cache.has('key_to_delete')).toBe(false);
      expect(cache.get('key_to_delete')).toBeNull();
    });

    it('returns false when deleting a non-existent key', () => {
      const deleted = cache.delete('not_there');
      expect(deleted).toBe(false);
    });

    it('decrements cache size after deleting key', () => {
      cache.set('k1', 'v1');
      cache.set('k2', 'v2');
      expect(cache.size).toBe(2);

      cache.delete('k1');
      expect(cache.size).toBe(1);
    });
  });

  describe('Clear Operation', () => {
    it('clears all cached entries and resets size to 0', () => {
      cache.set('k1', 1);
      cache.set('k2', 2);
      cache.set('k3', 3, 5000);

      expect(cache.size).toBe(3);

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.get('k1')).toBeNull();
      expect(cache.get('k2')).toBeNull();
      expect(cache.get('k3')).toBeNull();
      expect(cache.has('k1')).toBe(false);
      expect(cache.has('k2')).toBe(false);
      expect(cache.has('k3')).toBe(false);
    });
  });

  describe('Batch Set and Chaining', () => {
    it('supports method chaining with set', () => {
      const returned = cache.set('a', 1).set('b', 2);
      expect(returned).toBe(cache);
      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBe(2);
      expect(cache.size).toBe(2);
    });

    it('sets multiple entries via setBatch', () => {
      cache.setBatch([
        { key: 'batch1', value: 'res1' },
        { key: 'batch2', value: 'res2' },
        { key: 'batch3', value: 'res3', ttl: 5000 },
      ]);

      expect(cache.size).toBe(3);
      expect(cache.get('batch1')).toBe('res1');
      expect(cache.get('batch2')).toBe('res2');
      expect(cache.get('batch3')).toBe('res3');
    });

    it('gracefully handles invalid batch inputs', () => {
      cache.setBatch(null);
      cache.setBatch(undefined);
      cache.setBatch('not-an-array');
      cache.setBatch([null, undefined, { key: 'valid', value: 'ok' }]);

      expect(cache.get('valid')).toBe('ok');
    });
  });

  describe('attachResponseCleanup', () => {
    it('removes event listeners when response finishes or closes', () => {
      const emitter = new EventEmitter();
      const res = new EventEmitter();

      const cleanup = attachResponseCleanup(emitter, res, 'customEvent');
      expect(typeof cleanup).toBe('function');
      expect(emitter.listenerCount('customEvent')).toBe(1);
      expect(res.listenerCount('finish')).toBe(1);
      expect(res.listenerCount('close')).toBe(1);

      res.emit('finish');

      expect(emitter.listenerCount('customEvent')).toBe(0);
      expect(res.listenerCount('finish')).toBe(0);
      expect(res.listenerCount('close')).toBe(0);
    });
  });
});
