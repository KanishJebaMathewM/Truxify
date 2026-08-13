import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  CacheEventType,
  createCacheEvent,
  serializeCacheEvent,
  deserializeCacheEvent,
} = await import('../../src/cache/CacheEvent.js');

describe('CacheEvent', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe('createCacheEvent', () => {
    it('creates a valid INVALIDATE_KEY event with all fields', () => {
      const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
        namespace: 'orders',
        key: 'order:123',
        entityId: '123',
        subKey: 'details',
        originInstanceId: 'instance-1',
        timestamp: 1710000000000,
      });

      expect(event.id).toBeTruthy();
      expect(event.type).toBe(CacheEventType.INVALIDATE_KEY);
      expect(event.namespace).toBe('orders');
      expect(event.key).toBe('order:123');
      expect(event.entityId).toBe('123');
      expect(event.subKey).toBe('details');
      expect(event.originInstanceId).toBe('instance-1');
      expect(event.timestamp).toBe(1710000000000);
    });

    it('creates INVALIDATE_KEY event with only required fields', () => {
      const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
        namespace: 'profiles',
        key: 'profile:abc',
      });

      expect(event.type).toBe(CacheEventType.INVALIDATE_KEY);
      expect(event.namespace).toBe('profiles');
      expect(event.key).toBe('profile:abc');
      expect(event.pattern).toBeNull();
      expect(event.entityId).toBeNull();
    });

    it('creates INVALIDATE_PATTERN event', () => {
      const event = createCacheEvent(CacheEventType.INVALIDATE_PATTERN, {
        namespace: 'drivers',
        pattern: 'driver:*',
        entityId: '456',
      });

      expect(event.type).toBe(CacheEventType.INVALIDATE_PATTERN);
      expect(event.namespace).toBe('drivers');
      expect(event.pattern).toBe('driver:*');
      expect(event.key).toBeNull();
    });

    it('creates BUMP_VERSION event', () => {
      const event = createCacheEvent(CacheEventType.BUMP_VERSION, {
        namespace: 'trips',
        originInstanceId: 'instance-2',
      });

      expect(event.type).toBe(CacheEventType.BUMP_VERSION);
      expect(event.namespace).toBe('trips');
      expect(event.key).toBeNull();
      expect(event.pattern).toBeNull();
    });

    it('generates a UUID for each event', () => {
      const event1 = createCacheEvent(CacheEventType.INVALIDATE_KEY, { namespace: 'a', key: 'x' });
      const event2 = createCacheEvent(CacheEventType.INVALIDATE_KEY, { namespace: 'a', key: 'x' });
      expect(event1.id).not.toBe(event2.id);
    });

    it('auto-sets timestamp when omitted', () => {
      const before = Date.now();
      const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, { namespace: 'x', key: 'y' });
      const after = Date.now();
      expect(event.timestamp).toBeGreaterThanOrEqual(before);
      expect(event.timestamp).toBeLessThanOrEqual(after);
    });

    it('throws TypeError for invalid event type', () => {
      expect(() =>
        createCacheEvent('INVALID_FOO', { namespace: 'x', key: 'y' }),
      ).toThrow(TypeError);
    });

    it('throws TypeError for null event type', () => {
      expect(() =>
        // @ts-ignore
        createCacheEvent(null, { namespace: 'x', key: 'y' }),
      ).toThrow(TypeError);
    });

    it('throws TypeError when namespace is missing', () => {
      expect(() =>
        createCacheEvent(CacheEventType.INVALIDATE_KEY, { key: 'x' }),
      ).toThrow(TypeError);
    });

    it('throws TypeError when namespace is empty string', () => {
      expect(() =>
        createCacheEvent(CacheEventType.INVALIDATE_KEY, { namespace: '  ', key: 'x' }),
      ).toThrow(TypeError);
    });

    it('throws TypeError for INVALIDATE_KEY when key is missing', () => {
      expect(() =>
        createCacheEvent(CacheEventType.INVALIDATE_KEY, { namespace: 'x' }),
      ).toThrow(TypeError);
    });

    it('throws TypeError for INVALIDATE_PATTERN when pattern is missing', () => {
      expect(() =>
        createCacheEvent(CacheEventType.INVALIDATE_PATTERN, { namespace: 'x' }),
      ).toThrow(TypeError);
    });
  });

  describe('serializeCacheEvent', () => {
    it('returns valid JSON string', () => {
      const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
        namespace: 'orders',
        key: 'order:999',
      });
      const json = serializeCacheEvent(event);
      expect(typeof json).toBe('string');
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('serialized output can be deserialized back to the original event', () => {
      const original = createCacheEvent(CacheEventType.BUMP_VERSION, {
        namespace: 'metrics',
        entityId: 'ent-1',
      });
      const json = serializeCacheEvent(original);
      const parsed = JSON.parse(json);
      expect(parsed.type).toBe(original.type);
      expect(parsed.namespace).toBe(original.namespace);
      expect(parsed.entityId).toBe(original.entityId);
    });

    it('preserves the originInstanceId through a round-trip', () => {
      const original = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
        namespace: 'profile',
        key: 'profile:user-1',
        originInstanceId: 'instance-abc',
      });
      const json = serializeCacheEvent(original);
      const parsed = JSON.parse(json);
      expect(parsed.originInstanceId).toBe('instance-abc');
    });
  });

  describe('deserializeCacheEvent', () => {
    it('deserializes a valid JSON event', () => {
      const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
        namespace: 'profiles',
        key: 'profile:42',
      });
      const json = serializeCacheEvent(event);
      const result = deserializeCacheEvent(json);

      expect(result).not.toBeNull();
      expect(result.type).toBe(CacheEventType.INVALIDATE_KEY);
      expect(result.namespace).toBe('profiles');
      expect(result.key).toBe('profile:42');
    });

    it('returns null for malformed JSON', () => {
      const result = deserializeCacheEvent('not valid json {{{');
      expect(result).toBeNull();
    });

    it('returns null for empty string', () => {
      const result = deserializeCacheEvent('');
      expect(result).toBeNull();
    });

    it('returns null when namespace is missing from event object', () => {
      const result = deserializeCacheEvent(JSON.stringify({ type: CacheEventType.INVALIDATE_KEY }));
      expect(result).toBeNull();
    });

    it('returns null when event type is unrecognized', () => {
      const result = deserializeCacheEvent(
        JSON.stringify({ namespace: 'x', type: 'UNKNOWN_TYPE', id: '123' }),
      );
      expect(result).toBeNull();
    });

    it('returns null when event is a primitive', () => {
      expect(deserializeCacheEvent('"just a string"')).toBeNull();
      expect(deserializeCacheEvent('123')).toBeNull();
    });
  });
});
