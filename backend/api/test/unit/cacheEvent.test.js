import { describe, it, expect } from 'vitest';

import {
  CacheEventType,
  createCacheEvent,
  serializeCacheEvent,
  deserializeCacheEvent,
} from '../../src/cache/CacheEvent.js';

describe('CacheEventType', () => {
  it('has all expected event types', () => {
    expect(CacheEventType).toEqual({
      INVALIDATE_KEY: 'INVALIDATE_KEY',
      INVALIDATE_PATTERN: 'INVALIDATE_PATTERN',
      INVALIDATE_NAMESPACE: 'INVALIDATE_NAMESPACE',
      BUMP_VERSION: 'BUMP_VERSION',
      REFRESH: 'REFRESH',
    });
  });

  it('has exactly 5 entries', () => {
    expect(Object.keys(CacheEventType)).toHaveLength(5);
  });

  it('is frozen and cannot be modified', () => {
    expect(Object.isFrozen(CacheEventType)).toBe(true);

    expect(() => {
      CacheEventType.NEW_TYPE = 'NEW_TYPE';
    }).toThrow();

    expect(() => {
      CacheEventType.INVALIDATE_KEY = 'changed';
    }).toThrow();

    expect(CacheEventType.INVALIDATE_KEY).toBe('INVALIDATE_KEY');
  });
});

describe('createCacheEvent', () => {
  it('creates an event with correct type and namespace', () => {
    const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
      namespace: 'users',
    });

    expect(event.type).toBe('INVALIDATE_KEY');
    expect(event.namespace).toBe('users');
  });

  it('generates a unique UUID for each event', () => {
    const a = createCacheEvent(CacheEventType.REFRESH, { namespace: 'ns' });
    const b = createCacheEvent(CacheEventType.REFRESH, { namespace: 'ns' });

    expect(a.id).toBeDefined();
    expect(b.id).toBeDefined();
    expect(typeof a.id).toBe('string');
    expect(a.id).not.toBe(b.id);
  });

  it('UUID matches standard v4 format', () => {
    const event = createCacheEvent(CacheEventType.BUMP_VERSION, {
      namespace: 'ns',
    });
    expect(event.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('sets a default timestamp close to Date.now()', () => {
    const before = Date.now();
    const event = createCacheEvent(CacheEventType.INVALIDATE_PATTERN, {
      namespace: 'ns',
    });
    const after = Date.now();

    expect(event.timestamp).toBeGreaterThanOrEqual(before);
    expect(event.timestamp).toBeLessThanOrEqual(after);
  });

  it('accepts a custom timestamp', () => {
    const customTs = 1700000000000;
    const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
      namespace: 'ns',
      timestamp: customTs,
    });

    expect(event.timestamp).toBe(customTs);
  });

  it('sets optional fields to null when not provided', () => {
    const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
      namespace: 'ns',
    });

    expect(event.key).toBeNull();
    expect(event.pattern).toBeNull();
    expect(event.entityId).toBeNull();
    expect(event.subKey).toBeNull();
    expect(event.originInstanceId).toBeNull();
  });

  it('accepts optional key field', () => {
    const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
      namespace: 'ns',
      key: 'user:123',
    });
    expect(event.key).toBe('user:123');
  });

  it('accepts optional pattern field', () => {
    const event = createCacheEvent(CacheEventType.INVALIDATE_PATTERN, {
      namespace: 'ns',
      pattern: 'user:*',
    });
    expect(event.pattern).toBe('user:*');
  });

  it('accepts optional entityId field', () => {
    const event = createCacheEvent(CacheEventType.REFRESH, {
      namespace: 'ns',
      entityId: 'entity-42',
    });
    expect(event.entityId).toBe('entity-42');
  });

  it('accepts optional subKey field', () => {
    const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
      namespace: 'ns',
      key: 'user:123',
      subKey: 'profile',
    });
    expect(event.subKey).toBe('profile');
  });

  it('accepts optional originInstanceId field', () => {
    const event = createCacheEvent(CacheEventType.BUMP_VERSION, {
      namespace: 'ns',
      originInstanceId: 'instance-abc',
    });
    expect(event.originInstanceId).toBe('instance-abc');
  });

  it('returns all fields when every option is provided', () => {
    const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
      namespace: 'orders',
      key: 'order:999',
      entityId: 'order-999',
      subKey: 'items',
      originInstanceId: 'node-3',
      timestamp: 1234567890,
    });

    expect(event).toEqual({
      id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
      type: 'INVALIDATE_KEY',
      namespace: 'orders',
      key: 'order:999',
      pattern: null,
      entityId: 'order-999',
      subKey: 'items',
      originInstanceId: 'node-3',
      timestamp: 1234567890,
    });
  });

  it('defaults opts to empty object when omitted', () => {
    const event = createCacheEvent(CacheEventType.BUMP_VERSION);
    expect(event.type).toBe('BUMP_VERSION');
    expect(event.namespace).toBeUndefined();
  });
});

describe('serializeCacheEvent', () => {
  it('returns a valid JSON string', () => {
    const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
      namespace: 'ns',
      key: 'k',
    });

    const json = serializeCacheEvent(event);
    expect(typeof json).toBe('string');

    const parsed = JSON.parse(json);
    expect(parsed).toEqual(event);
  });

  it('produces JSON that can be round-tripped', () => {
    const event = createCacheEvent(CacheEventType.INVALIDATE_PATTERN, {
      namespace: 'cache',
      pattern: '*:meta',
      originInstanceId: 'i-1',
    });

    const json = serializeCacheEvent(event);
    const roundTrip = JSON.parse(json);

    expect(roundTrip.id).toBe(event.id);
    expect(roundTrip.type).toBe(event.type);
    expect(roundTrip.namespace).toBe(event.namespace);
    expect(roundTrip.pattern).toBe(event.pattern);
    expect(roundTrip.originInstanceId).toBe(event.originInstanceId);
  });

  it('throws TypeError when input is undefined, null, or non-object', () => {
    expect(() => serializeCacheEvent(undefined)).toThrow(TypeError);
    expect(() => serializeCacheEvent(null)).toThrow(TypeError);
    expect(() => serializeCacheEvent('not-an-object')).toThrow(TypeError);
    expect(() => serializeCacheEvent(123)).toThrow(TypeError);
  });
});

describe('deserializeCacheEvent', () => {
  it('correctly parses valid JSON', () => {
    const original = createCacheEvent(CacheEventType.INVALIDATE_NAMESPACE, {
      namespace: 'sessions',
    });
    const json = serializeCacheEvent(original);

    const result = deserializeCacheEvent(json);
    expect(result).toEqual(original);
  });

  it('returns null for invalid JSON strings', () => {
    expect(deserializeCacheEvent('not-json')).toBeNull();
    expect(deserializeCacheEvent('{incomplete')).toBeNull();
    expect(deserializeCacheEvent('')).toBeNull();
  });

  it('returns null if type is missing', () => {
    const json = JSON.stringify({ namespace: 'ns', id: '123' });
    expect(deserializeCacheEvent(json)).toBeNull();
  });

  it('returns null if namespace is missing', () => {
    const json = JSON.stringify({ type: 'INVALIDATE_KEY', id: '123' });
    expect(deserializeCacheEvent(json)).toBeNull();
  });

  it('returns null for empty object', () => {
    expect(deserializeCacheEvent('{}')).toBeNull();
  });

  it('returns null for null input wrapped in JSON', () => {
    expect(deserializeCacheEvent('null')).toBeNull();
  });

  it('round-trips a fully populated event', () => {
    const original = createCacheEvent(CacheEventType.REFRESH, {
      namespace: 'products',
      key: 'product:5',
      entityId: '5',
      subKey: 'reviews',
      originInstanceId: 'node-7',
      timestamp: 9999999,
    });

    const result = deserializeCacheEvent(serializeCacheEvent(original));
    expect(result).toEqual(original);
  });
});
