import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PolicyRegistry } from '../../src/core/auth/PolicyRegistry.js';
import { Permission } from '../../src/core/auth/Permission.js';
import { BasePolicy } from '../../src/core/auth/BasePolicy.js';

describe('PolicyRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new PolicyRegistry();
  });

  describe('register', () => {
    it('registers a permission and returns it', () => {
      const perm = new Permission({ action: 'order:view', roles: ['driver', 'customer'] });
      const result = registry.register(perm);
      expect(result).toBe(perm);
      expect(registry.get('order:view')).toBe(perm);
    });

    it('throws when registering a duplicate action', () => {
      registry.register(new Permission({ action: 'order:view', roles: ['driver'] }));
      expect(() => registry.register(new Permission({ action: 'order:view', roles: ['customer'] })))
        .toThrow('Permission already registered');
    });
  });

  describe('registerAll', () => {
    it('registers multiple permissions', () => {
      registry.registerAll([
        { action: 'order:view', roles: ['driver'] },
        { action: 'order:create', roles: ['customer'] },
      ]);
      expect(registry.get('order:view')).toBeDefined();
      expect(registry.get('order:create')).toBeDefined();
    });
  });

  describe('registerPolicy', () => {
    it('registers all permissions from a BasePolicy', () => {
      const policy = new BasePolicy('order');
      policy.define({ action: 'order:view', roles: ['driver', 'customer'] });
      policy.define({ action: 'order:create', roles: ['customer'] });
      registry.registerPolicy(policy);
      expect(registry.get('order:view')).toBeDefined();
      expect(registry.get('order:create')).toBeDefined();
    });
  });

  describe('get', () => {
    it('returns undefined for unknown action', () => {
      expect(registry.get('unknown:action')).toBeUndefined();
    });
  });

  describe('has', () => {
    it('returns true for registered action', () => {
      registry.register(new Permission({ action: 'order:view', roles: ['driver'] }));
      expect(registry.has('order:view')).toBe(true);
    });

    it('returns false for unregistered action', () => {
      expect(registry.has('order:view')).toBe(false);
    });
  });

  describe('listActions', () => {
    it('lists all registered actions', () => {
      registry.registerAll([
        { action: 'order:view', roles: ['driver'] },
        { action: 'order:create', roles: ['customer'] },
      ]);
      const actions = registry.listActions();
      expect(actions).toContain('order:view');
      expect(actions).toContain('order:create');
    });
  });

  describe('size', () => {
    it('returns the count of registered permissions', () => {
      expect(registry.size).toBe(0);
      registry.register(new Permission({ action: 'order:view', roles: ['driver'] }));
      expect(registry.size).toBe(1);
    });
  });

  describe('snapshot', () => {
    it('returns a snapshot with all registered policies', () => {
      registry.register(new Permission({ action: 'order:view', roles: ['driver'] }));
      const snap = registry.snapshot();
      expect(snap.totalPermissions).toBe(1);
      expect(snap.policies['order:view']).toBeDefined();
    });
  });
});
