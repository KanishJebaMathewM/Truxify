import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CacheKeyBuilder } from '../../src/cache/CacheKeyBuilder.js';
import { CacheNamespace } from '../../src/cache/CacheNamespace.js';

describe('CacheKeyBuilder', () => {
  beforeEach(() => {
    CacheNamespace.clear();
    CacheNamespace.register('profile', { defaultTtl: 900 });
    CacheNamespace.register('order', { defaultTtl: 300 });
  });

  afterEach(() => {
    CacheKeyBuilder._setRedisClient(null);
  });

  describe('build()', () => {
    it('creates key from registered namespace + entityId', () => {
      const key = CacheKeyBuilder.build('profile', 'sb:abc123');
      expect(key).toBe('profile:sb:abc123');
    });

    it('uses the namespace name as prefix when no custom prefix is set', () => {
      const key = CacheKeyBuilder.build('order', 'order-42');
      expect(key).toBe('order:order-42');
    });

    it('uses custom prefix when one is registered', () => {
      CacheNamespace.register('custom', { prefix: 'c:v2' });
      const key = CacheKeyBuilder.build('custom', 'entity-1');
      expect(key).toBe('c:v2:entity-1');
    });

    it('appends subKey when provided', () => {
      const key = CacheKeyBuilder.build('profile', 'sb:abc123', 'stats');
      expect(key).toBe('profile:sb:abc123:stats');
    });

    it('ignores subKey when falsy', () => {
      const key = CacheKeyBuilder.build('profile', 'sb:abc123', '');
      expect(key).toBe('profile:sb:abc123');
    });

    it('falls back gracefully for unknown namespace', () => {
      const key = CacheKeyBuilder.build('unknown', 'id-1');
      expect(key).toBe('unknown:id-1');
    });

    it('falls back gracefully for unknown namespace with subKey', () => {
      const key = CacheKeyBuilder.build('unknown', 'id-1', 'sub');
      expect(key).toBe('unknown:id-1:sub');
    });
  });

  describe('buildVersioned()', () => {
    it('includes version v1 by default', async () => {
      const key = await CacheKeyBuilder.buildVersioned('profile', 'sb:abc123');
      expect(key).toBe('profile:v1:sb:abc123');
    });

    it('uses custom version when provided', async () => {
      const key = await CacheKeyBuilder.buildVersioned('profile', 'sb:abc123', undefined, 5);
      expect(key).toBe('profile:v5:sb:abc123');
    });

    it('uses custom prefix with version', async () => {
      CacheNamespace.register('custom', { prefix: 'c:v2' });
      const key = await CacheKeyBuilder.buildVersioned('custom', 'entity-1', undefined, 3);
      expect(key).toBe('c:v2:v3:entity-1');
    });

    it('appends subKey after entityId', async () => {
      const key = await CacheKeyBuilder.buildVersioned('order', 'order-42', 'items', 2);
      expect(key).toBe('order:v2:order-42:items');
    });

    it('defaults to v1 for unknown namespace', async () => {
      const key = await CacheKeyBuilder.buildVersioned('unknown', 'id-1');
      expect(key).toBe('unknown:v1:id-1');
    });

    it('uses version 0 when explicitly passed', async () => {
      const key = await CacheKeyBuilder.buildVersioned('profile', 'id-1', undefined, 0);
      expect(key).toBe('profile:v0:id-1');
    });

    it('handles subKey without explicit version', async () => {
      const key = await CacheKeyBuilder.buildVersioned('profile', 'sb:abc123', 'driver');
      expect(key).toBe('profile:v1:sb:abc123:driver');
    });

    it('reads the live version from Redis and appends it to the key', async () => {
      const mockClient = { get: vi.fn().mockResolvedValue('7') };
      CacheKeyBuilder._setRedisClient(mockClient);
      const key = await CacheKeyBuilder.buildVersioned('profile', 'sb:abc123');
      expect(mockClient.get).toHaveBeenCalledWith('profile:version:sb:abc123');
      expect(key).toBe('profile:v7:sb:abc123');
    });

    it('produces a different key after a version bump', async () => {
      let version = 1;
      const mockClient = {
        get: vi.fn(() => Promise.resolve(String(version))),
        incr: vi.fn(() => {
          version += 1;
          return Promise.resolve(version);
        }),
      };
      CacheKeyBuilder._setRedisClient(mockClient);

      const keyBefore = await CacheKeyBuilder.buildVersioned('profile', 'sb:abc123');
      expect(keyBefore).toBe('profile:v1:sb:abc123');

      await mockClient.incr('profile:version:sb:abc123');

      const keyAfter = await CacheKeyBuilder.buildVersioned('profile', 'sb:abc123');
      expect(keyAfter).toBe('profile:v2:sb:abc123');
    });

    it('respects a custom versionKey', async () => {
      const mockClient = { get: vi.fn().mockResolvedValue('3') };
      CacheKeyBuilder._setRedisClient(mockClient);
      const key = await CacheKeyBuilder.buildVersioned(
        'profile',
        'sb:abc123',
        undefined,
        undefined,
        { versionKey: 'cache:version:profile' }
      );
      expect(mockClient.get).toHaveBeenCalledWith('cache:version:profile');
      expect(key).toBe('profile:v3:sb:abc123');
    });

    it('defaults to v1 when no Redis client is configured', async () => {
      const key = await CacheKeyBuilder.buildVersioned('profile', 'sb:abc123');
      expect(key).toBe('profile:v1:sb:abc123');
    });

    it('falls back to v1 when the version read fails', async () => {
      const mockClient = { get: vi.fn().mockRejectedValue(new Error('redis down')) };
      CacheKeyBuilder._setRedisClient(mockClient);
      const key = await CacheKeyBuilder.buildVersioned('profile', 'sb:abc123');
      expect(key).toBe('profile:v1:sb:abc123');
    });

    it('falls back to v1 when the version read times out', async () => {
      const mockClient = {
        get: vi.fn(() => new Promise(() => {})),
      };
      CacheKeyBuilder._setRedisClient(mockClient);
      const key = await CacheKeyBuilder.buildVersioned('profile', 'sb:abc123', undefined, undefined, { timeoutMs: 20 });
      expect(key).toBe('profile:v1:sb:abc123');
    });

    it('treats a non-numeric stored version as v1', async () => {
      const mockClient = { get: vi.fn().mockResolvedValue('not-a-number') };
      CacheKeyBuilder._setRedisClient(mockClient);
      const key = await CacheKeyBuilder.buildVersioned('profile', 'sb:abc123');
      expect(key).toBe('profile:v1:sb:abc123');
    });
  });

  describe('versionKey()', () => {
    it('returns version storage key for a namespace + entityId', () => {
      const key = CacheKeyBuilder.versionKey('profile', 'sb:abc123');
      expect(key).toBe('profile:version:sb:abc123');
    });

    it('includes subKey when provided', () => {
      const key = CacheKeyBuilder.versionKey('order', 'order-42', 'items');
      expect(key).toBe('order:version:order-42:items');
    });

    it('uses custom prefix when registered', () => {
      CacheNamespace.register('custom', { prefix: 'c:v2' });
      const key = CacheKeyBuilder.versionKey('custom', 'entity-1');
      expect(key).toBe('c:v2:version:entity-1');
    });

    it('falls back for unknown namespace', () => {
      const key = CacheKeyBuilder.versionKey('unknown', 'id-1');
      expect(key).toBe('unknown:version:id-1');
    });
  });

  describe('pattern()', () => {
    it('creates SCAN glob matching all versions for an entity', () => {
      const pat = CacheKeyBuilder.pattern('profile', 'sb:abc123');
      expect(pat).toBe('profile:*:sb:abc123*');
    });

    it('matches entire namespace when entityId is omitted', () => {
      const pat = CacheKeyBuilder.pattern('profile');
      expect(pat).toBe('profile:*');
    });

    it('matches entire namespace when entityId is undefined', () => {
      const pat = CacheKeyBuilder.pattern('profile', undefined);
      expect(pat).toBe('profile:*');
    });

    it('matches entire namespace when entityId is empty string', () => {
      const pat = CacheKeyBuilder.pattern('profile', '');
      expect(pat).toBe('profile:*');
    });

    it('uses custom prefix in pattern', () => {
      CacheNamespace.register('custom', { prefix: 'c:v2' });
      const pat = CacheKeyBuilder.pattern('custom', 'entity-1');
      expect(pat).toBe('c:v2:*:entity-1*');
    });

    it('falls back for unknown namespace', () => {
      const pat = CacheKeyBuilder.pattern('unknown', 'id-1');
      expect(pat).toBe('unknown:*:id-1*');
    });

    it('falls back for unknown namespace without entityId', () => {
      const pat = CacheKeyBuilder.pattern('unknown');
      expect(pat).toBe('unknown:*');
    });
  });

  describe('pubSubChannel()', () => {
    it('returns channel name from namespace name', () => {
      expect(CacheKeyBuilder.pubSubChannel('profile')).toBe('cache:invalidate:profile');
    });

    it('uses the raw namespace name, not the prefix', () => {
      CacheNamespace.register('custom', { prefix: 'c:v2' });
      expect(CacheKeyBuilder.pubSubChannel('custom')).toBe('cache:invalidate:custom');
    });

    it('works for all registered namespaces', () => {
      expect(CacheKeyBuilder.pubSubChannel('order')).toBe('cache:invalidate:order');
      expect(CacheKeyBuilder.pubSubChannel('rate_limit')).toBe('cache:invalidate:rate_limit');
    });
  });

  describe('parse()', () => {
    it('decomposes a simple key with a single-segment entityId', () => {
      const result = CacheKeyBuilder.parse('profile:user-123');
      expect(result).toEqual({
        namespace: 'profile',
        version: null,
        entityId: 'user-123',
        subKey: null,
      });
    });

    it('decomposes a versioned key', () => {
      const result = CacheKeyBuilder.parse('profile:v1:user-123');
      expect(result).toEqual({
        namespace: 'profile',
        version: 'v1',
        entityId: 'user-123',
        subKey: null,
      });
    });

    it('decomposes a versioned key with subKey', () => {
      const result = CacheKeyBuilder.parse('profile:v2:user-123:stats');
      expect(result).toEqual({
        namespace: 'profile',
        version: 'v2',
        entityId: 'user-123',
        subKey: 'stats',
      });
    });

    it('decomposes a versioned key with multi-part subKey', () => {
      const result = CacheKeyBuilder.parse('order:v3:order-42:items:line:1');
      expect(result).toEqual({
        namespace: 'order',
        version: 'v3',
        entityId: 'order-42',
        subKey: 'items:line:1',
      });
    });

    it('decomposes a simple key with subKey', () => {
      const result = CacheKeyBuilder.parse('order:order-42:items');
      expect(result).toEqual({
        namespace: 'order',
        version: null,
        entityId: 'order-42',
        subKey: 'items',
      });
    });

    it('handles a key with only namespace', () => {
      const result = CacheKeyBuilder.parse('profile');
      expect(result).toEqual({
        namespace: 'profile',
        version: null,
        entityId: null,
        subKey: null,
      });
    });

    it('treats segment not starting with v as entityId not version', () => {
      const result = CacheKeyBuilder.parse('profile:alpha:beta');
      expect(result).toEqual({
        namespace: 'profile',
        version: null,
        entityId: 'alpha',
        subKey: 'beta',
      });
    });

    it('handles multi-segment entityId as entityId + subKey (colon limitation)', () => {
      const result = CacheKeyBuilder.parse('profile:sb:abc123');
      expect(result).toEqual({
        namespace: 'profile',
        version: null,
        entityId: 'sb',
        subKey: 'abc123',
      });
    });

    it('round-trips buildVersioned output correctly', async () => {
      const key = await CacheKeyBuilder.buildVersioned('order', 'order-42', 'items', 4);
      const parsed = CacheKeyBuilder.parse(key);
      expect(parsed).toEqual({
        namespace: 'order',
        version: 'v4',
        entityId: 'order-42',
        subKey: 'items',
      });
    });

    it('round-trips build output without version correctly', () => {
      const key = CacheKeyBuilder.build('order', 'order-42', 'items');
      const parsed = CacheKeyBuilder.parse(key);
      expect(parsed).toEqual({
        namespace: 'order',
        version: null,
        entityId: 'order-42',
        subKey: 'items',
      });
    });

    it('interprets versionKey "version" segment as version (starts with v)', () => {
      const key = CacheKeyBuilder.versionKey('profile', 'user-123');
      const parsed = CacheKeyBuilder.parse(key);
      expect(parsed).toEqual({
        namespace: 'profile',
        version: 'version',
        entityId: 'user-123',
        subKey: null,
      });
    });

    it('parses key with version zero', () => {
      const result = CacheKeyBuilder.parse('profile:v0:user-123');
      expect(result).toEqual({
        namespace: 'profile',
        version: 'v0',
        entityId: 'user-123',
        subKey: null,
      });
    });
  });
});
