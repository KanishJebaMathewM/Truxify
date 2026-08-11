import { describe, it, expect, vi } from 'vitest';
import {
  CacheEventType,
  createCacheEvent,
  serializeCacheEvent,
  deserializeCacheEvent,
} from '../../../src/cache/CacheEvent.js';

vi.mock('../../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('CacheEventType constants', () => {
  it('exposes the five invalidation event types', () => {
    expect(CacheEventType.INVALIDATE_KEY).toBe('INVALIDATE_KEY');
    expect(CacheEventType.INVALIDATE_PATTERN).toBe('INVALIDATE_PATTERN');
    expect(CacheEventType.INVALIDATE_NAMESPACE).toBe('INVALIDATE_NAMESPACE');
    expect(CacheEventType.BUMP_VERSION).toBe('BUMP_VERSION');
    expect(CacheEventType.REFRESH).toBe('REFRESH');
  });
});

describe('createCacheEvent', () => {
  it('creates a full event with auto-generated id and timestamp', () => {
    const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
      namespace: 'profile',
      key: 'user:profile:abc',
      entityId: 'abc',
      originInstanceId: 'instance-1',
    });

    expect(typeof event.id).toBe('string');
    expect(event.id.length).toBeGreaterThan(0);
    expect(event.type).toBe(CacheEventType.INVALIDATE_KEY);
    expect(event.namespace).toBe('profile');
    expect(event.key).toBe('user:profile:abc');
    expect(event.entityId).toBe('abc');
    expect(event.originInstanceId).toBe('instance-1');
    expect(typeof event.timestamp).toBe('number');
  });

  it('rejects an invalid event type', () => {
    expect(() => createCacheEvent('NOPE', { namespace: 'profile' })).toThrow(TypeError);
    expect(() => createCacheEvent('NOPE', { namespace: 'profile' })).toThrow(
      /Invalid cache event type/,
    );
  });

  it('rejects a missing event type', () => {
    expect(() => createCacheEvent(undefined, { namespace: 'profile' })).toThrow(TypeError);
  });

  it('rejects a non-object options argument', () => {
    expect(() => createCacheEvent(CacheEventType.REFRESH, null)).toThrow(TypeError);
    expect(() => createCacheEvent(CacheEventType.REFRESH, 'nope')).toThrow(TypeError);
  });

  it('rejects a missing or blank namespace', () => {
    expect(() => createCacheEvent(CacheEventType.REFRESH, {})).toThrow(/namespace/);
    expect(() => createCacheEvent(CacheEventType.REFRESH, { namespace: '  ' })).toThrow(/namespace/);
  });

  it('requires a key for INVALIDATE_KEY', () => {
    expect(() =>
      createCacheEvent(CacheEventType.INVALIDATE_KEY, { namespace: 'profile' }),
    ).toThrow(/key/);
    expect(() =>
      createCacheEvent(CacheEventType.INVALIDATE_KEY, { namespace: 'profile', key: '  ' }),
    ).toThrow(/key/);
  });

  it('requires a pattern for INVALIDATE_PATTERN', () => {
    expect(() =>
      createCacheEvent(CacheEventType.INVALIDATE_PATTERN, { namespace: 'profile' }),
    ).toThrow(/pattern/);
  });

  it('defaults optional fields to null and honours an explicit timestamp', () => {
    const timestamp = 1234567890;
    const event = createCacheEvent(CacheEventType.REFRESH, {
      namespace: 'profile',
      timestamp,
    });

    expect(event.key).toBeNull();
    expect(event.pattern).toBeNull();
    expect(event.entityId).toBeNull();
    expect(event.subKey).toBeNull();
    expect(event.originInstanceId).toBeNull();
    expect(event.timestamp).toBe(timestamp);
  });
});

describe('serializeCacheEvent / deserializeCacheEvent', () => {
  it('round-trips a valid event through JSON', () => {
    const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
      namespace: 'order',
      key: 'order:123',
      entityId: '123',
    });

    const parsed = deserializeCacheEvent(serializeCacheEvent(event));

    expect(parsed).toEqual(event);
  });

  it('returns null for invalid JSON', () => {
    expect(deserializeCacheEvent('not json {')).toBeNull();
  });

  it('returns null for a payload without a namespace', () => {
    expect(deserializeCacheEvent(JSON.stringify({ type: CacheEventType.REFRESH }))).toBeNull();
  });

  it('returns null for an unrecognized event type', () => {
    expect(
      deserializeCacheEvent(JSON.stringify({ type: 'NOPE', namespace: 'profile' })),
    ).toBeNull();
  });
});
