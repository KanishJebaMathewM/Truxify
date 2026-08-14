/**
 * Unit tests for backend/api/src/cache/CacheNamespace.js
 *
 * Coverage:
 *   - register: adds namespace with prefix
 *   - register: uses namespace name as default prefix
 *   - register: throws for duplicate name
 *   - register: throws for invalid name/prefix
 *   - get: retrieves registered namespace
 *   - get: returns null for unknown namespace
 *   - has: true for registered, false for unknown
 *   - unregister: removes namespace
 *   - list: returns all registered names
 *   - clear: removes all namespaces
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CacheNamespace } from '../../src/cache/CacheNamespace.js';

describe('CacheNamespace', () => {
  beforeEach(() => {
    CacheNamespace.clear();
    CacheNamespace.register('profile', 'user:profile');
    CacheNamespace.register('order', 'order');
    CacheNamespace.register('driver', 'driver');
  });

  describe('register', () => {
    it('adds namespace with custom prefix', () => {
      CacheNamespace.register('trip', 'trip');
      expect(CacheNamespace.get('trip').prefix).toBe('trip');
    });

    it('uses namespace name as default prefix', () => {
      CacheNamespace.register('vehicle');
      expect(CacheNamespace.get('vehicle').prefix).toBe('vehicle');
    });

    it('throws for duplicate name', () => {
      expect(() => CacheNamespace.register('profile', 'new:prefix')).toThrow(Error);
    });

    it('throws for invalid name', () => {
      expect(() => CacheNamespace.register(null)).toThrow(TypeError);
    });
  });

  describe('get', () => {
    it('retrieves registered namespace', () => {
      expect(CacheNamespace.get('profile').prefix).toBe('user:profile');
    });

    it('returns null for unknown namespace', () => {
      expect(CacheNamespace.get('unknown_ns')).toBeNull();
    });
  });

  describe('has', () => {
    it('true for registered namespace', () => {
      expect(CacheNamespace.has('profile')).toBe(true);
    });

    it('false for unknown namespace', () => {
      expect(CacheNamespace.has('not_registered')).toBe(false);
    });
  });

  describe('unregister', () => {
    it('removes namespace', () => {
      CacheNamespace.unregister('profile');
      expect(CacheNamespace.has('profile')).toBe(false);
    });

    it('unknown namespace is no-op', () => {
      expect(() => CacheNamespace.unregister('unknown')).not.toThrow();
    });
  });

  describe('list', () => {
    it('returns all registered names', () => {
      const names = CacheNamespace.list();
      expect(names).toContain('profile');
      expect(names).toContain('order');
      expect(names).toContain('driver');
    });
  });

  describe('clear', () => {
    it('removes all namespaces', () => {
      CacheNamespace.clear();
      expect(CacheNamespace.list()).toHaveLength(0);
    });
  });
});
