import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

import {
  CacheEventType,
  createCacheEvent,
  serializeCacheEvent,
  deserializeCacheEvent,
} from '../../../src/cache/CacheEvent.js';

describe('CacheEventType', () => {
  it('exports all expected event types', () => {
    expect(CacheEventType.INVALIDATE_KEY).toBe('INVALIDATE_KEY');
    expect(CacheEventType.INVALIDATE_PATTERN).toBe('INVALIDATE_PATTERN');
    expect(CacheEventType.INVALIDATE_NAMESPACE).toBe('INVALIDATE_NAMESPACE');
    expect(CacheEventType.BUMP_VERSION).toBe('BUMP_VERSION');
    expect(CacheEventType.REFRESH).toBe('REFRESH');
  });
});

describe('createCacheEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('INVALIDATE_KEY', () => {
    it('creates event with required fields', () => {
      const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
        namespace: 'orders',
        key: 'order:123',
      });
      expect(event.type).toBe('INVALIDATE_KEY');
      expect(event.namespace).toBe('orders');
      expect(event.key).toBe('order:123');
      expect(event.pattern).toBeNull();
      expect(typeof event.id).toBe('string');
      expect(typeof event.timestamp).toBe('number');
    });

    it('throws when key is missing', () => {
      expect(() =>
        createCacheEvent(CacheEventType.INVALIDATE_KEY, { namespace: 'orders' })
      ).toThrow(TypeError);
    });

    it('throws when key is empty string', () => {
      expect(() =>
        createCacheEvent(CacheEventType.INVALIDATE_KEY, { namespace: 'orders', key: '' })
      ).toThrow(TypeError);
    });
  });

  describe('INVALIDATE_PATTERN', () => {
    it('creates event with pattern field', () => {
      const event = createCacheEvent(CacheEventType.INVALIDATE_PATTERN, {
        namespace: 'orders',
        pattern: 'order:*',
      });
      expect(event.type).toBe('INVALIDATE_PATTERN');
      expect(event.pattern).toBe('order:*');
    });

    it('throws when pattern is missing', () => {
      expect(() =>
        createCacheEvent(CacheEventType.INVALIDATE_PATTERN, { namespace: 'orders' })
      ).toThrow(TypeError);
    });
  });

  describe('INVALIDATE_NAMESPACE', () => {
    it('creates event without key or pattern', () => {
      const event = createCacheEvent(CacheEventType.INVALIDATE_NAMESPACE, {
        namespace: 'orders',
      });
      expect(event.type).toBe('INVALIDATE_NAMESPACE');
      expect(event.namespace).toBe('orders');
      expect(event.key).toBeNull();
      expect(event.pattern).toBeNull();
    });
  });

  describe('BUMP_VERSION', () => {
    it('creates event with namespace', () => {
      const event = createCacheEvent(CacheEventType.BUMP_VERSION, {
        namespace: 'profiles',
      });
      expect(event.type).toBe('BUMP_VERSION');
      expect(event.namespace).toBe('profiles');
    });
  });

  describe('REFRESH', () => {
    it('creates event with key', () => {
      const event = createCacheEvent(CacheEventType.REFRESH, {
        namespace: 'profiles',
        key: 'profile:456',
      });
      expect(event.type).toBe('REFRESH');
      expect(event.key).toBe('profile:456');
    });
  });

  describe('validation', () => {
    it('throws for invalid event type', () => {
      expect(() =>
        createCacheEvent('INVALID_TYPE', { namespace: 'orders' })
      ).toThrow(TypeError);
    });

    it('throws for null type', () => {
      expect(() =>
        createCacheEvent(null, { namespace: 'orders' })
      ).toThrow(TypeError);
    });

    it('throws when namespace is missing', () => {
      expect(() =>
        createCacheEvent(CacheEventType.INVALIDATE_KEY, { key: 'order:123' })
      ).toThrow(TypeError);
    });

    it('throws when namespace is empty string', () => {
      expect(() =>
        createCacheEvent(CacheEventType.INVALIDATE_KEY, { namespace: '', key: 'order:123' })
      ).toThrow(TypeError);
    });

    it('throws when opts is not an object', () => {
      expect(() =>
        createCacheEvent(CacheEventType.INVALIDATE_KEY, 'not-an-object')
      ).toThrow(TypeError);
    });

    it('includes optional fields as null when not provided', () => {
      const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
        namespace: 'orders',
        key: 'order:123',
      });
      expect(event.entityId).toBeNull();
      expect(event.subKey).toBeNull();
      expect(event.originInstanceId).toBeNull();
    });

    it('accepts optional fields when provided', () => {
      const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
        namespace: 'orders',
        key: 'order:123',
        entityId: 'ent-1',
        subKey: 'sub-1',
        originInstanceId: 'inst-1',
        timestamp: 1700000000000,
      });
      expect(event.entityId).toBe('ent-1');
      expect(event.subKey).toBe('sub-1');
      expect(event.originInstanceId).toBe('inst-1');
      expect(event.timestamp).toBe(1700000000000);
    });
  });
});

describe('serializeCacheEvent', () => {
  it('serializes event to JSON string', () => {
    const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
      namespace: 'orders',
      key: 'order:123',
    });
    const json = serializeCacheEvent(event);
    expect(typeof json).toBe('string');
    expect(JSON.parse(json)).toEqual(event);
  });
});

describe('deserializeCacheEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deserializes valid JSON string', () => {
    const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
      namespace: 'orders',
      key: 'order:123',
    });
    const json = serializeCacheEvent(event);
    const deserialized = deserializeCacheEvent(json);
    expect(deserialized.type).toBe('INVALIDATE_KEY');
    expect(deserialized.namespace).toBe('orders');
    expect(deserialized.key).toBe('order:123');
  });

  it('returns null for invalid JSON', () => {
    expect(deserializeCacheEvent('not valid json')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(deserializeCacheEvent(null)).toBeNull();
  });

  it('returns null when namespace is missing', () => {
    expect(deserializeCacheEvent('{"type":"INVALIDATE_KEY","key":"order:123"}')).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('returns null for unrecognized event type', () => {
    expect(deserializeCacheEvent('{"type":"INVALID_TYPE","namespace":"orders"}')).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalled();
  });
});
