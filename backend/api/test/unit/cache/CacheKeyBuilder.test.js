import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

import { CacheKeyBuilder } from '../../../src/cache/CacheKeyBuilder.js';
import { CacheNamespace } from '../../../src/cache/CacheNamespace.js';

describe('CacheKeyBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('build', () => {
    it('builds a key from a registered namespace prefix', () => {
      CacheNamespace.register('profile', { prefix: 'user:profile' });
      expect(CacheKeyBuilder.build('profile', 'sb:abc')).toBe('user:profile:sb:abc');
    });

    it('appends a sub-key when provided', () => {
      CacheNamespace.register('profile', { prefix: 'user:profile' });
      expect(CacheKeyBuilder.build('profile', 'sb:abc', 'stats')).toBe('user:profile:sb:abc:stats');
    });

    it('falls back to the raw namespace name when unregistered', () => {
      const key = CacheKeyBuilder.build('unknown_ns', 'entity-1');
      expect(key).toBe('unknown_ns:entity-1');
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('buildVersioned', () => {
    it('uses the provided version without touching Redis', async () => {
      CacheNamespace.register('profile', { prefix: 'user:profile' });
      const key = await CacheKeyBuilder.buildVersioned('profile', 'u1', null, 3);
      expect(key).toBe('user:profile:v3:u1');
    });

    it('falls back to v1 with no Redis client', async () => {
      CacheKeyBuilder._setRedisClient(null);
      const key = await CacheKeyBuilder.buildVersioned('profile', 'u1');
      expect(key).toBe('user:profile:v1:u1');
    });

    it('reads the live version from Redis when available', async () => {
      const client = { get: vi.fn().mockResolvedValue('7') };
      CacheKeyBuilder._setRedisClient(client);
      CacheNamespace.register('profile', { prefix: 'user:profile' });

      const key = await CacheKeyBuilder.buildVersioned('profile', 'u1');
      expect(key).toBe('user:profile:v7:u1');
      CacheKeyBuilder._setRedisClient(null);
    });

    it('falls back to v1 when the Redis read fails', async () => {
      const client = { get: vi.fn().mockRejectedValue(new Error('redis down')) };
      CacheKeyBuilder._setRedisClient(client);

      const key = await CacheKeyBuilder.buildVersioned('profile', 'u1');
      expect(key).toBe('user:profile:v1:u1');
      CacheKeyBuilder._setRedisClient(null);
    });

    it('falls back to v1 when the Redis value is not a number', async () => {
      const client = { get: vi.fn().mockResolvedValue('not-a-number') };
      CacheKeyBuilder._setRedisClient(client);

      const key = await CacheKeyBuilder.buildVersioned('profile', 'u1');
      expect(key).toBe('user:profile:v1:u1');
      CacheKeyBuilder._setRedisClient(null);
    });
  });

  describe('versionKey', () => {
    it('builds the version counter key', () => {
      CacheNamespace.register('profile', { prefix: 'user:profile' });
      expect(CacheKeyBuilder.versionKey('profile', 'u1')).toBe('user:profile:version:u1');
    });
  });

  describe('pattern', () => {
    it('builds a namespace-wide pattern when no entity is given', () => {
      CacheNamespace.register('profile', { prefix: 'user:profile' });
      expect(CacheKeyBuilder.pattern('profile')).toBe('user:profile:*');
    });

    it('builds an entity-scoped prefix pattern', () => {
      CacheNamespace.register('profile', { prefix: 'user:profile' });
      expect(CacheKeyBuilder.pattern('profile', 'sb:abc123')).toBe('user:profile:sb:abc123*');
    });
  });

  describe('pubSubChannel', () => {
    it('uses the cache:invalidate prefix with the namespace', () => {
      expect(CacheKeyBuilder.pubSubChannel('profile')).toBe('cache:invalidate:profile');
    });
  });

  describe('parse', () => {
    it('parses an unversioned key', () => {
      const parsed = CacheKeyBuilder.parse('profile:u1');
      expect(parsed).toEqual({
        namespace: 'profile',
        version: null,
        entityId: 'u1',
        subKey: null,
      });
    });

    it('parses a versioned key with a sub-key', () => {
      const parsed = CacheKeyBuilder.parse('profile:v2:u1:stats');
      expect(parsed).toEqual({
        namespace: 'profile',
        version: 'v2',
        entityId: 'u1',
        subKey: 'stats',
      });
    });

    it('parses a versioned key without a sub-key', () => {
      const parsed = CacheKeyBuilder.parse('profile:v2:u1');
      expect(parsed).toEqual({
        namespace: 'profile',
        version: 'v2',
        entityId: 'u1',
        subKey: null,
      });
    });
  });
});
