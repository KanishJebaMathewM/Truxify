/**
 * Unit tests for backend/api/src/cache/CacheEvent.js
 *
 * Coverage:
 *   - CacheEvent constructor: type, key, metadata, timestamp
 *   - CacheEvent constructor: throws for missing type
 *   - CacheEvent constructor: throws for missing key
 *   - CacheEvent.toJSON: serializes all fields
 *   - CacheEvent.createInvalidate: correct type and key
 *   - CacheEvent.createRefresh: correct type and key
 *   - CacheEvent.createEvict: correct type and key
 *   - CacheEvent.createWarm: correct type and key
 *   - CacheEvent.isInvalidate/isRefresh/isEvict/isWarm type guards
 *   - CacheEvent.matchesKey: key matching logic
 *   - CacheEvent.getAge: returns ms since timestamp
 *   - CacheEvent.setMeta: adds/overwrites metadata
 *   - CacheEvent.toString: formatted string
 *   - CacheEvent.clone: new instance, new timestamp
 *   - CacheEvent.fromJSON: reconstructs from serialized
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CacheEvent } from '../../src/cache/CacheEvent.js';

describe('CacheEvent', () => {
  describe('constructor', () => {
    it('creates event with type, key, and metadata', () => {
      const event = new CacheEvent('INVALIDATE', 'user:123', { reason: 'update' });
      expect(event.type).toBe('INVALIDATE');
      expect(event.key).toBe('user:123');
      expect(event.metadata.reason).toBe('update');
    });

    it('generates timestamp when not provided', () => {
      const before = Date.now();
      const event = new CacheEvent('REFRESH', 'order:456');
      const after = Date.now();
      expect(event.timestamp).toBeGreaterThanOrEqual(before);
      expect(event.timestamp).toBeLessThanOrEqual(after);
    });

    it('uses provided timestamp', () => {
      const ts = 1700000000000;
      const event = new CacheEvent('EVICT', 'session:abc', {}, ts);
      expect(event.timestamp).toBe(ts);
    });

    it('throws for missing type', () => {
      expect(() => new CacheEvent(null, 'key:123')).toThrow(TypeError);
    });

    it('throws for missing key', () => {
      expect(() => new CacheEvent('INVALIDATE', null)).toThrow(TypeError);
    });
  });

  describe('toJSON', () => {
    it('serializes all fields', () => {
      const event = new CacheEvent('REFRESH', 'cache:key', { src: 'db' }, 1700000000000);
      const json = event.toJSON();
      expect(json.type).toBe('REFRESH');
      expect(json.key).toBe('cache:key');
      expect(json.metadata.src).toBe('db');
      expect(json.timestamp).toBe(1700000000000);
    });

    it('defaults metadata to empty object', () => {
      const event = new CacheEvent('INVALIDATE', 'key:123');
      expect(event.toJSON().metadata).toEqual({});
    });
  });

  describe('factory methods', () => {
    it('createInvalidate sets correct type and key', () => {
      const event = CacheEvent.createInvalidate('user:profile:123');
      expect(event.type).toBe('INVALIDATE');
      expect(event.key).toBe('user:profile:123');
    });

    it('createRefresh sets correct type', () => {
      expect(CacheEvent.createRefresh('k').type).toBe('REFRESH');
    });

    it('createEvict sets correct type', () => {
      expect(CacheEvent.createEvict('k').type).toBe('EVICT');
    });

    it('createWarm sets correct type', () => {
      expect(CacheEvent.createWarm('k').type).toBe('WARM');
    });
  });

  describe('type guards', () => {
    it('isInvalidate: true for INVALIDATE', () => {
      expect(CacheEvent.createInvalidate('k').isInvalidate()).toBe(true);
    });

    it('isInvalidate: false for REFRESH', () => {
      expect(CacheEvent.createRefresh('k').isInvalidate()).toBe(false);
    });

    it('isRefresh: true for REFRESH', () => {
      expect(CacheEvent.createRefresh('k').isRefresh()).toBe(true);
    });

    it('isEvict: true for EVICT', () => {
      expect(CacheEvent.createEvict('k').isEvict()).toBe(true);
    });

    it('isWarm: true for WARM', () => {
      expect(CacheEvent.createWarm('k').isWarm()).toBe(true);
    });
  });

  describe('matchesKey', () => {
    it('returns true for matching key', () => {
      expect(CacheEvent.createInvalidate('order:123').matchesKey('order:123')).toBe(true);
    });

    it('returns false for different key', () => {
      expect(CacheEvent.createInvalidate('order:123').matchesKey('order:456')).toBe(false);
    });

    it('returns true for key prefix match', () => {
      expect(CacheEvent.createInvalidate('profile:user:abc').matchesKey('profile:user:*')).toBe(true);
    });
  });

  describe('getAge', () => {
    it('returns ms since timestamp', () => {
      const oldTs = Date.now() - 5000;
      const event = new CacheEvent('REFRESH', 'k', {}, oldTs);
      expect(event.getAge()).toBeGreaterThanOrEqual(5000);
    });
  });

  describe('setMeta', () => {
    it('adds metadata field', () => {
      const event = new CacheEvent('INVALIDATE', 'k');
      event.setMeta('src', 'db');
      expect(event.metadata.src).toBe('db');
    });

    it('overwrites existing field', () => {
      const event = new CacheEvent('INVALIDATE', 'k', { src: 'old' });
      event.setMeta('src', 'new');
      expect(event.metadata.src).toBe('new');
    });
  });

  describe('toString', () => {
    it('returns formatted string', () => {
      const str = CacheEvent.createRefresh('key:123').toString();
      expect(str).toContain('REFRESH');
      expect(str).toContain('key:123');
    });
  });

  describe('clone', () => {
    it('creates new instance with same data', () => {
      const original = CacheEvent.createInvalidate('k', { src: 'db' });
      const cloned = original.clone();
      expect(cloned.type).toBe(original.type);
      expect(cloned.key).toBe(original.key);
    });

    it('new timestamp set', () => {
      const original = CacheEvent.createRefresh('k');
      const cloned = original.clone();
      expect(cloned.timestamp).toBeGreaterThanOrEqual(original.timestamp);
    });

    it('new object reference', () => {
      const original = CacheEvent.createWarm('k');
      const cloned = original.clone();
      expect(cloned).not.toBe(original);
    });
  });

  describe('fromJSON', () => {
    it('reconstructs from serialized', () => {
      const json = { type: 'REFRESH', key: 'session:abc', metadata: { src: 'api' }, timestamp: 1700000000000 };
      const event = CacheEvent.fromJSON(json);
      expect(event.type).toBe('REFRESH');
      expect(event.key).toBe('session:abc');
    });

    it('metadata is deep copied', () => {
      const json = { type: 'EVICT', key: 'k', metadata: { nested: { value: 1 } }, timestamp: 0 };
      const event = CacheEvent.fromJSON(json);
      event.metadata.nested.value = 99;
      expect(json.metadata.nested.value).toBe(1);
    });
  });
});
