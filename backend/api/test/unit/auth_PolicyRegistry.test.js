/**
 * Unit tests for backend/api/src/core/auth/PolicyRegistry.js
 *
 * Coverage:
 *   - register: adds a permission / throws for duplicate
 *   - registerAll: registers multiple permissions
 *   - get: retrieves / returns null for unknown
 *   - listActions / listPermissions: returns registered items
 *   - has: true for registered, false for unknown
 *   - size: returns count of permissions
 *   - snapshot: creates debug snapshot
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PolicyRegistry } from '../../src/core/auth/PolicyRegistry.js';
import { Permission } from '../../src/core/auth/Permission.js';

describe('PolicyRegistry', () => {
  let registry;

  beforeEach(() => { registry = new PolicyRegistry(); });

  describe('register', () => {
    it('registers a permission object', () => {
      const perm = new Permission({ action: 'order:create', roles: ['admin', 'customer'] });
      const result = registry.register(perm);
      expect(result.action).toBe('order:create');
      expect(registry._permissions.has('order:create')).toBe(true);
    });

    it('registers a permission from plain object', () => {
      expect(registry.register({ action: 'trip:view', roles: ['admin'] }).action).toBe('trip:view');
    });

    it('throws for duplicate action', () => {
      registry.register({ action: 'order:view', roles: ['admin'] });
      expect(() => registry.register({ action: 'order:view', roles: ['admin'] })).toThrow(Error);
    });
  });

  describe('registerAll', () => {
    it('registers multiple permissions', () => {
      registry.registerAll([{ action: 'load:create', roles: ['admin'] }, { action: 'load:accept', roles: ['admin', 'driver'] }]);
      expect(registry._permissions.size).toBe(2);
    });
  });

  describe('get', () => {
    it('retrieves a registered permission', () => {
      registry.register({ action: 'order:cancel', roles: ['admin', 'customer'] });
      expect(registry.get('order:cancel').action).toBe('order:cancel');
    });

    it('returns undefined for unknown action', () => {
      expect(registry.get('unknown:action')).toBeUndefined();
    });
  });

  describe('listActions', () => {
    it('returns all registered action names', () => {
      registry.register({ action: 'a:first', roles: ['admin'] });
      registry.register({ action: 'b:second', roles: ['admin'] });
      const names = registry.listActions();
      expect(names).toContain('a:first');
      expect(names).toContain('b:second');
      expect(names).toHaveLength(2);
    });

    it('returns empty array for empty registry', () => {
      expect(registry.listActions()).toEqual([]);
    });
  });

  describe('listPermissions', () => {
    it('returns all registered permissions', () => {
      registry.register({ action: 'perm:first', roles: ['admin'] });
      registry.register({ action: 'perm:second', roles: ['admin'] });
      expect(registry.listPermissions().length).toBe(2);
    });
  });

  describe('has', () => {
    it('returns true for registered action', () => {
      registry.register({ action: 'profile:view', roles: ['admin'] });
      expect(registry.has('profile:view')).toBe(true);
    });

    it('returns false for unknown action', () => {
      expect(registry.has('unknown:action')).toBe(false);
    });
  });

  describe('size', () => {
    it('returns count of permissions', () => {
      expect(registry.size).toBe(0);
      registry.register({ action: 'first', roles: ['admin'] });
      expect(registry.size).toBe(1);
    });
  });

  describe('snapshot', () => {
    it('creates a debug snapshot', () => {
      registry.register({ action: 'snap:first', roles: ['admin'] });
      const snap = registry.snapshot();
      expect(snap.totalPermissions).toBe(1);
      expect(snap.policies['snap:first']).toBeTruthy();
    });
  });
});
