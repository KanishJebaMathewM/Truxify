/**
 * Unit tests for backend/api/src/cache/CacheEvent.js
 *
 * Coverage of the factory API (the class-based API was retired):
 *   - createCacheEvent: valid event shape; invalid type; missing namespace;
 *     key required for INVALIDATE_KEY; pattern required for INVALIDATE_PATTERN;
 *     optional fields default to null
 *   - serializeCacheEvent/deserializeCacheEvent: round-trip; null for
 *     invalid JSON, missing namespace, or unrecognized type
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const {
  CacheEventType,
  createCacheEvent,
  serializeCacheEvent,
  deserializeCacheEvent,
} = await import('../../src/cache/CacheEvent.js');

describe('CacheEvent (factory contract)', () => {
  describe('createCacheEvent', () => {
    it('creates a key-invalidation event with a unique id and timestamp', () => {
      const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
        namespace: 'profile',
        key: 'user:profile:123',
      });
      expect(event.type).toBe('INVALIDATE_KEY');
      expect(event.namespace).toBe('profile');
      expect(event.key).toBe('user:profile:123');
      expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(typeof event.timestamp).toBe('number');
    });

    it('assigns a fresh id per event', () => {
      const a = createCacheEvent(CacheEventType.INVALIDATE_NAMESPACE, { namespace: 'order' });
      const b = createCacheEvent(CacheEventType.INVALIDATE_NAMESPACE, { namespace: 'order' });
      expect(a.id).not.toBe(b.id);
    });

    it('throws TypeError for an unknown event type', () => {
      expect(() => createCacheEvent('EVICT', { namespace: 'profile' })).toThrow(TypeError);
    });

    it('throws TypeError when namespace is missing or empty', () => {
      expect(() => createCacheEvent(CacheEventType.REFRESH, {})).toThrow(TypeError);
      expect(() => createCacheEvent(CacheEventType.REFRESH, { namespace: '  ' })).toThrow(TypeError);
      expect(() => createCacheEvent(CacheEventType.REFRESH, { namespace: 42 })).toThrow(TypeError);
    });

    it('requires key for INVALIDATE_KEY', () => {
      expect(() => createCacheEvent(CacheEventType.INVALIDATE_KEY, { namespace: 'profile' })).toThrow(TypeError);
    });

    it('requires pattern for INVALIDATE_PATTERN', () => {
      expect(() => createCacheEvent(CacheEventType.INVALIDATE_PATTERN, { namespace: 'profile' })).toThrow(TypeError);
      const event = createCacheEvent(CacheEventType.INVALIDATE_PATTERN, {
        namespace: 'profile',
        pattern: 'user:profile:*',
      });
      expect(event.pattern).toBe('user:profile:*');
    });

    it('allows namespace invalidation and version bumps without a key', () => {
      expect(createCacheEvent(CacheEventType.INVALIDATE_NAMESPACE, { namespace: 'order' }).key).toBeNull();
      expect(createCacheEvent(CacheEventType.BUMP_VERSION, { namespace: 'order', entityId: 'order-9' }).entityId).toBe('order-9');
    });

    it('defaults optional fields to null and preserves provided ones', () => {
      const event = createCacheEvent(CacheEventType.REFRESH, { namespace: 'lookup' });
      expect(event.key).toBeNull();
      expect(event.pattern).toBeNull();
      expect(event.originInstanceId).toBeNull();

      const rich = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
        namespace: 'profile',
        key: 'k',
        entityId: 'user-1',
        subKey: 'sub',
        originInstanceId: 'instance-a',
      });
      expect(rich.entityId).toBe('user-1');
      expect(rich.subKey).toBe('sub');
      expect(rich.originInstanceId).toBe('instance-a');
    });
  });

  describe('serialize/deserialize round-trip', () => {
    it('round-trips a full event through JSON', () => {
      const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
        namespace: 'profile',
        key: 'user:1',
        entityId: 'u1',
      });
      const back = deserializeCacheEvent(serializeCacheEvent(event));
      expect(back).toEqual(event);
    });

    it('returns null for invalid JSON', () => {
      expect(deserializeCacheEvent('not-json{')).toBeNull();
    });

    it('returns null for a payload missing the namespace', () => {
      expect(deserializeCacheEvent(JSON.stringify({ type: 'INVALIDATE_KEY', key: 'k' }))).toBeNull();
    });

    it('returns null for an unrecognized event type', () => {
      expect(deserializeCacheEvent(JSON.stringify({ type: 'EVICT', namespace: 'x' }))).toBeNull();
    });
  });
});
