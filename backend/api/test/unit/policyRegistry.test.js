import { describe, it, expect } from 'vitest';
import { PolicyRegistry } from '../../src/core/auth/PolicyRegistry.js';
import { Permission } from '../../src/core/auth/Permission.js';

describe('PolicyRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new PolicyRegistry();
  });

  describe('register', () => {
    it('registers a permission and returns it', () => {
      const perm = new Permission({ action: 'order:view', roles: ['driver'] });
      const result = registry.register(perm);
      expect(result).toBe(perm);
    });

    it('registers a permission from an object', () => {
      const result = registry.register({ action: 'order:view', roles: ['driver'] });
      expect(registry.get('order:view')).toBeDefined();
      expect(registry.get('order:view').action).toBe('order:view');
    });

    it('throws when action is already registered', () => {
      registry.register({ action: 'order:view', roles: ['driver'] });
      expect(() => {
        registry.register({ action: 'order:view', roles: ['admin'] });
      }).toThrow('Permission already registered for action: order:view');
    });
  });

  describe('registerAll', () => {
    it('registers multiple permissions', () => {
      registry.registerAll([
        { action: 'order:view', roles: ['driver'] },
        { action: 'order:delete', roles: ['admin'] },
      ]);
      expect(registry.size).toBe(2);
      expect(registry.has('order:view')).toBe(true);
      expect(registry.has('order:delete')).toBe(true);
    });

    it('throws on duplicate within registerAll', () => {
      expect(() => {
        registry.registerAll([
          { action: 'order:view', roles: ['driver'] },
          { action: 'order:view', roles: ['admin'] },
        ]);
      }).toThrow('Permission already registered for action: order:view');
    });
  });

  describe('get', () => {
    it('returns the correct permission', () => {
      registry.register({ action: 'order:view', roles: ['driver'] });
      const perm = registry.get('order:view');
      expect(perm).toBeDefined();
      expect(perm.action).toBe('order:view');
    });

    it('returns undefined for unknown action', () => {
      expect(registry.get('order:view')).toBeUndefined();
    });
  });

  describe('has', () => {
    it('returns true for registered action', () => {
      registry.register({ action: 'order:view', roles: ['driver'] });
      expect(registry.has('order:view')).toBe(true);
    });

    it('returns false for unregistered action', () => {
      expect(registry.has('order:view')).toBe(false);
    });
  });

  describe('listActions', () => {
    it('returns sorted action names', () => {
      registry.registerAll([
        { action: 'order:delete', roles: ['admin'] },
        { action: 'order:view', roles: ['driver'] },
        { action: 'order:update', roles: ['driver'] },
      ]);
      const actions = registry.listActions();
      expect(actions).toEqual(['order:delete', 'order:update', 'order:view']);
    });

    it('returns empty array when no permissions registered', () => {
      expect(registry.listActions()).toEqual([]);
    });
  });

  describe('listPermissions', () => {
    it('returns all permission objects', () => {
      registry.registerAll([
        { action: 'order:view', roles: ['driver'] },
        { action: 'order:delete', roles: ['admin'] },
      ]);
      const perms = registry.listPermissions();
      expect(perms).toHaveLength(2);
      expect(perms.map(p => p.action).sort()).toEqual(['order:delete', 'order:view']);
    });
  });

  describe('size', () => {
    it('returns the correct count', () => {
      expect(registry.size).toBe(0);
      registry.register({ action: 'order:view', roles: ['driver'] });
      expect(registry.size).toBe(1);
      registry.register({ action: 'order:delete', roles: ['admin'] });
      expect(registry.size).toBe(2);
    });
  });

  describe('snapshot', () => {
    it('produces a valid JSON object with correct count', () => {
      registry.registerAll([
        { action: 'order:view', roles: ['driver'] },
        { action: 'order:delete', roles: ['admin'] },
      ]);
      const snap = registry.snapshot();
      expect(snap.totalPermissions).toBe(2);
      expect(snap.policies['order:view']).toBeDefined();
      expect(snap.policies['order:delete']).toBeDefined();
    });
  });
});
