import { describe, it, expect, vi } from 'vitest';
import { CacheKeyBuilder } from '../../../src/cache/CacheKeyBuilder.js';

vi.mock('../../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('CacheKeyBuilder', () => {
  describe('build', () => {
    it('builds a key from a registered namespace and entity id', () => {
      // 'profile' is registered with prefix 'user:profile'.
      expect(CacheKeyBuilder.build('profile', 'sb:abc123')).toBe('user:profile:sb:abc123');
    });

    it('appends a sub-key when provided', () => {
      expect(CacheKeyBuilder.build('profile', 'sb:abc123', 'stats')).toBe(
        'user:profile:sb:abc123:stats',
      );
    });

    it('falls back to the raw namespace when the namespace is unregistered', () => {
      expect(CacheKeyBuilder.build('zz-missing-ns', 'entity-1')).toBe('zz-missing-ns:entity-1');
    });
  });

  describe('versionKey', () => {
    it('builds the version counter key', () => {
      expect(CacheKeyBuilder.versionKey('profile', 'sb:abc123')).toBe('user:profile:version:sb:abc123');
    });

    it('appends a sub-key when provided', () => {
      expect(CacheKeyBuilder.versionKey('profile', 'sb:abc123', 'stats')).toBe(
        'user:profile:version:sb:abc123:stats',
      );
    });
  });

  describe('pattern', () => {
    it('builds a namespace-wide glob pattern', () => {
      expect(CacheKeyBuilder.pattern('profile')).toBe('user:profile:*');
    });

    it('builds an entity-scoped glob pattern', () => {
      expect(CacheKeyBuilder.pattern('profile', 'sb:abc123')).toBe('user:profile:sb:abc123*');
    });
  });

  describe('pubSubChannel', () => {
    it('builds the pub/sub channel name', () => {
      expect(CacheKeyBuilder.pubSubChannel('profile')).toBe('cache:invalidate:profile');
    });
  });

  describe('parse', () => {
    it('parses an unversioned key with the second segment as the entity id', () => {
      expect(CacheKeyBuilder.parse('user:profile:sb:abc123')).toEqual({
        namespace: 'user',
        version: null,
        entityId: 'profile',
        subKey: 'sb:abc123',
      });
    });

    it('parses an unversioned key with a sub-key', () => {
      expect(CacheKeyBuilder.parse('user:profile:sb:abc123:stats')).toEqual({
        namespace: 'user',
        version: null,
        entityId: 'profile',
        subKey: 'sb:abc123:stats',
      });
    });

    it('treats a key whose second segment is not version-shaped as unversioned', () => {
      expect(CacheKeyBuilder.parse('user:profile:v2:sb:abc123')).toEqual({
        namespace: 'user',
        version: null,
        entityId: 'profile',
        subKey: 'v2:sb:abc123',
      });
    });

    it('parses a key whose second segment starts with v as versioned', () => {
      expect(CacheKeyBuilder.parse('user:v2:sb:abc123')).toEqual({
        namespace: 'user',
        version: 'v2',
        entityId: 'sb',
        subKey: 'abc123',
      });
    });

    it('parses a versioned key with a sub-key', () => {
      expect(CacheKeyBuilder.parse('user:v3:sb:abc123:stats')).toEqual({
        namespace: 'user',
        version: 'v3',
        entityId: 'sb',
        subKey: 'abc123:stats',
      });
    });

    it('handles a two-segment key', () => {
      expect(CacheKeyBuilder.parse('user:profile')).toEqual({
        namespace: 'user',
        version: null,
        entityId: 'profile',
        subKey: null,
      });
    });
  });
});
