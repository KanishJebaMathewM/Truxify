/**
 * Unit tests for backend/api/src/cache/CacheKeyBuilder.js
 *
 * Coverage:
 *   - build: basic namespace + entity (with registered prefix)
 *   - build: with subKey parameter
 *   - build: unknown namespace uses namespace as prefix
 *   - build: does not throw for null namespace
 *   - pattern: generates correct wildcard pattern with entity
 *   - pattern: generates namespace-wide wildcard
 *   - _setRedisClient: wires the Redis client
 *   - buildVersioned: returns versioned key when version provided
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CacheKeyBuilder } from '../../src/cache/CacheKeyBuilder.js';

describe('CacheKeyBuilder', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe('build', () => {
    it('builds a key with namespace and entity using registered prefix', () => {
      expect(CacheKeyBuilder.build('profile', 'sb:abc123')).toBe('user:profile:sb:abc123');
    });

    it('builds a key with subKey', () => {
      expect(CacheKeyBuilder.build('profile', 'sb:abc123', 'stats')).toBe('user:profile:sb:abc123:stats');
    });

    it('uses namespace as prefix for unregistered namespace', () => {
      expect(CacheKeyBuilder.build('unregistered_ns', 'entity:456')).toBe('unregistered_ns:entity:456');
    });

    it('does not throw for null namespace', () => {
      expect(() => CacheKeyBuilder.build(null, 'entity:123')).not.toThrow();
    });
  });

  describe('pattern', () => {
    it('generates a wildcard pattern for namespace and entity', () => {
      expect(CacheKeyBuilder.pattern('profile', 'sb:abc123')).toBe('user:profile:sb:abc123*');
    });

    it('generates a namespace-wide pattern when entityId omitted', () => {
      expect(CacheKeyBuilder.pattern('profile')).toBe('user:profile:*');
    });

    it('generates a pattern for unregistered namespace', () => {
      expect(CacheKeyBuilder.pattern('unknown_ns', 'entity:789')).toBe('unknown_ns:entity:789*');
    });
  });

  describe('_setRedisClient', () => {
    it('wires the Redis client without throwing', () => {
      expect(() => CacheKeyBuilder._setRedisClient(null)).not.toThrow();
      expect(() => CacheKeyBuilder._setRedisClient({})).not.toThrow();
    });
  });

  describe('buildVersioned', () => {
    it('returns versioned key when version provided', async () => {
      const key = await CacheKeyBuilder.buildVersioned('profile', 'sb:abc123', undefined, 'v2');
      expect(key).toContain('v2');
      expect(key).toContain('user:profile');
    });
  });
});
