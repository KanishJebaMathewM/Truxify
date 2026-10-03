import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('CacheEvent', () => {
  let createCacheEvent;
  let serializeCacheEvent;
  let deserializeCacheEvent;
  let CacheEventType;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const mod = await import('../../src/cache/CacheEvent.js');
    createCacheEvent = mod.createCacheEvent;
    serializeCacheEvent = mod.serializeCacheEvent;
    deserializeCacheEvent = mod.deserializeCacheEvent;
    CacheEventType = mod.CacheEventType;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── CacheEventType ─────────────────────────────────────────────────────

  describe('CacheEventType', () => {
    it('defines INVALIDATE_KEY', () => {
      expect(CacheEventType.INVALIDATE_KEY).toBe('INVALIDATE_KEY');
    });

    it('defines INVALIDATE_PATTERN', () => {
      expect(CacheEventType.INVALIDATE_PATTERN).toBe('INVALIDATE_PATTERN');
    });

    it('defines INVALIDATE_NAMESPACE', () => {
      expect(CacheEventType.INVALIDATE_NAMESPACE).toBe('INVALIDATE_NAMESPACE');
    });

    it('defines BUMP_VERSION', () => {
      expect(CacheEventType.BUMP_VERSION).toBe('BUMP_VERSION');
    });

    it('defines REFRESH', () => {
      expect(CacheEventType.REFRESH).toBe('REFRESH');
    });

    it('values are frozen (immutable)', () => {
      expect(Object.isFrozen(CacheEventType.INVALIDATE_KEY)).toBe(true);
    });
  });

  // ── createCacheEvent ───────────────────────────────────────────────────

  describe('createCacheEvent', () => {
    it('creates INVALIDATE_KEY event with correct structure', () => {
      const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, { 
        namespace: 'profile', 
      key: 'user:profile:sb:123',
      });

      expect(event).toHaveProperty('id');
      expect(event.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(event.type).toBe(CacheEventType.INVALIDATE_KEY);
      expect(event.namespace).toBe('profile');
      expect(event.key).toBe('user:profile:sb:123');
      expect(event.pattern).toBeNull();
      expect(event.entityId).toBeNull();
      expect(event.subKey).toBeNull();
      expect(event.originInstanceId).toBeNull();
      expect(event.timestamp).toBeDefined();
    });

    it('creates INVALIDATE_PATTERN event with correct structure', () => {
      const event = createCacheEvent(CacheEventType.INVALIDATE_PATTERN, {
        namespace: 'order',
        pattern: 'order:sb:*',
      });

      expect(event.type).toBe(CacheEventType.INVALIDATE_PATTERN);
      expect(event.namespace).toBe('order');
      expect(event.pattern).toBe('order:sb:*');
      expect(event.key).toBeNull();
    });

    it('creates INVALIDATE_NAMESPACE event', () => {
      const event = createCacheEvent(CacheEventType.INVALIDATE_NAMESPACE, {
        namespace: 'driver',
      });

      expect(event.type).toBe(CacheEventType.INVALIDATE_NAMESPACE);
      expect(event.namespace).toBe('driver');
    });

    it('creates BUMP_VERSION event', () => {
      const event = createCacheEvent(CacheEventType.BUMP_VERSION, {
        namespace: 'profile',
        entityId: 'sb:123',
      });

      expect(event.type).toBe(CacheEventType.BUMP_VERSION);
      expect(event.namespace).toBe('profile');
      expect(event.entityId).toBe('sb:123');
    });

    it('creates REFRESH event', () => {
      const event = createCacheEvent(CacheEventType.REFRESH, {
        namespace: 'order',
        key: 'order:123',
      });

      expect(event.type).toBe(CacheEventType.REFRESH);
      expect(event.namespace).toBe('order');
      expect(event.key).toBe('order:123');
    });

    it('accepts optional originInstanceId', () => {
      const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
        namespace: 'profile',
        key: 'key-1',
        originInstanceId: 'instance-abc',
      });

      expect(event.originInstanceId).toBe('instance-abc');
    });

    it('accepts optional entityId', () => {
      const event = createCacheEvent(CacheEventType.BUMP_VERSION, {
        namespace: 'profile',
        entityId: 'sb:456',
      });

      expect(event.entityId).toBe('sb:456');
    });

    it('accepts optional subKey', () => {
      const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
        namespace: 'profile',
        key: 'user:profile:sb:123',
        subKey: 'stats',
      });

      expect(event.subKey).toBe('stats');
    });

    it('uses provided timestamp when given', () => {
      const ts = 1700000000000;
      const event = createCacheEvent(CacheEventType.REFRESH, {
        namespace: 'order',
        key: 'order:1',
        timestamp: ts,
      });

      expect(event.timestamp).toBe(ts);
    });

    it('auto-generates timestamp when not provided', () => {
      const before = Date.now();
      const event = createCacheEvent(CacheEventType.REFRESH, {
        namespace: 'order',
        key: 'order:1',
      });
      const after = Date.now();

      expect(event.timestamp).toBeGreaterThanOrEqual(before);
      expect(event.timestamp).toBeLessThanOrEqual(after);
    });

    it('generates unique IDs per event', () => {
      const e1 = createCacheEvent(CacheEventType.REFRESH, { namespace: 'a', key: 'k1' });
      const e2 = createCacheEvent(CacheEventType.REFRESH, { namespace: 'a', key: 'k2' });
      expect(e1.id).not.toBe(e2.id);
    });

    it('throws for invalid event type', () => {
      expect(() =>
        createCacheEvent('INVALID_TYPE', { namespace: 'profile' }),
      ).toThrow(TypeError);
    });

    it('throws for null event type', () => {
      expect(() => createCacheEvent(null, { namespace: 'profile' })).toThrow(TypeError);
    });

    it('throws for missing namespace', () => {
      expect(() => createCacheEvent(CacheEventType.INVALIDATE_KEY, {})).toThrow(TypeError);
    });

    it('throws for empty namespace string', () => {
      expect(() =>
        createCacheEvent(CacheEventType.INVALIDATE_KEY, { namespace: '  ' }),
      ).toThrow(TypeError);
    });

    it('throws for invalid namespace type', () => {
      expect(() =>
        createCacheEvent(CacheEventType.INVALIDATE_KEY, { namespace: 123 }),
      ).toThrow(TypeError);
    });

    it('throws when opts is missing for INVALIDATE_KEY', () => {
      expect(() => createCacheEvent(CacheEventType.INVALIDATE_KEY, null)).toThrow(TypeError);
    });

    it('throws when key is missing for INVALIDATE_KEY', () => {
      expect(() =>
        createCacheEvent(CacheEventType.INVALIDATE_KEY, { namespace: 'profile' }),
      ).toThrow(TypeError);
    });

    it('throws when key is empty for INVALIDATE_KEY', () => {
      expect(() =>
        createCacheEvent(CacheEventType.INVALIDATE_KEY, { namespace: 'profile', key: '' }),
      ).toThrow(TypeError);
    });

    it('throws when pattern is missing for INVALIDATE_PATTERN', () => {
      expect(() =>
        createCacheEvent(CacheEventType.INVALIDATE_PATTERN, { namespace: 'order' }),
      ).toThrow(TypeError);
    });

    it('throws when pattern is empty for INVALIDATE_PATTERN', () => {
      expect(() =>
        createCacheEvent(CacheEventType.INVALIDATE_PATTERN, { namespace: 'order', pattern: '' }),
      ).toThrow(TypeError);
    });

    it('does NOT require key for BUMP_VERSION', () => {
      const event = createCacheEvent(CacheEventType.BUMP_VERSION, { namespace: 'profile' });
      expect(event.type).toBe(CacheEventType.BUMP_VERSION);
    });
  });

  // ── serializeCacheEvent ────────────────────────────────────────────────

  describe('serializeCacheEvent', () => {
    it('serializes event to JSON string', () => {
      const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
        namespace: 'profile',
        key: 'user:profile:sb:123',
      });
      const json = serializeCacheEvent(event);
      expect(typeof json).toBe('string');
      const parsed = JSON.parse(json);
      expect(parsed.id).toBe(event.id);
      expect(parsed.type).toBe(CacheEventType.INVALIDATE_KEY);
      expect(parsed.namespace).toBe('profile');
    });

    it('round-trips through JSON parse', () => {
      const event = createCacheEvent(CacheEventType.REFRESH, {
        namespace: 'order',
        key: 'order:1',
        originInstanceId: 'i-1',
        subKey: 'stats',
      });
      const json = serializeCacheEvent(event);
      const parsed = JSON.parse(json);
      expect(parsed.type).toBe(event.type);
      expect(parsed.namespace).toBe(event.namespace);
      expect(parsed.key).toBe(event.key);
      expect(parsed.originInstanceId).toBe(event.originInstanceId);
      expect(parsed.subKey).toBe(event.subKey);
    });
  });

  // ── deserializeCacheEvent ──────────────────────────────────────────────

  describe('deserializeCacheEvent', () => {
    it('deserializes valid JSON string', () => {
      const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
        namespace: 'profile',
        key: 'key-1',
      });
      const json = serializeCacheEvent(event);
      const result = deserializeCacheEvent(json);
      expect(result.namespace).toBe('profile');
      expect(result.type).toBe(CacheEventType.INVALIDATE_KEY);
    });

    it('returns null for invalid JSON string', () => {
      const result = deserializeCacheEvent('not valid json {{{');
      expect(result).toBeNull();
    });

    it('returns null for empty string', () => {
      const result = deserializeCacheEvent('');
      expect(result).toBeNull();
    });

    it('returns null when namespace is missing', () => {
      const result = deserializeCacheEvent(JSON.stringify({ type: 'INVALIDATE_KEY' }));
      expect(result).toBeNull();
    });

    it('returns null when namespace is invalid type', () => {
      const result = deserializeCacheEvent(JSON.stringify({
        type: CacheEventType.INVALIDATE_KEY,
        namespace: 123,
      }));
      expect(result).toBeNull();
    });

    it('returns null when event type is unrecognized', () => {
      const result = deserializeCacheEvent(JSON.stringify({
        type: 'UNKNOWN_TYPE',
        namespace: 'profile',
      }));
      expect(result).toBeNull();
    });

    it('returns null for null input', () => {
      const result = deserializeCacheEvent(null);
      expect(result).toBeNull();
    });

    it('returns null for undefined input', () => {
      const result = deserializeCacheEvent(undefined);
      expect(result).toBeNull();
    });

    it('returns null for non-object parsed value', () => {
      const result = deserializeCacheEvent(JSON.stringify('just a string'));
      expect(result).toBeNull();
    });

    it('returns event with all fields preserved', () => {
      const event = createCacheEvent(CacheEventType.BUMP_VERSION, {
        namespace: 'profile',
        entityId: 'sb:123',
        subKey: 'stats',
        originInstanceId: 'inst-1',
      });
      const json = serializeCacheEvent(event);
      const result = deserializeCacheEvent(json);
      expect(result.entityId).toBe('sb:123');
      expect(result.subKey).toBe('stats');
      expect(result.originInstanceId).toBe('inst-1');
    });
  });
});
