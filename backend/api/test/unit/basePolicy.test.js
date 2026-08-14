import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BasePolicy } from '../../src/core/auth/BasePolicy.js';

describe('BasePolicy', () => {
  describe('constructor', () => {
    it('throws if namespace is not provided', () => {
      expect(() => new BasePolicy()).toThrow('BasePolicy requires a non-empty namespace string.');
    });

    it('throws if namespace is an empty string', () => {
      expect(() => new BasePolicy('')).toThrow('BasePolicy requires a non-empty namespace string.');
    });

    it('throws if namespace is not a string', () => {
      expect(() => new BasePolicy(123)).toThrow('BasePolicy requires a non-empty namespace string.');
    });

    it('creates a policy with a valid namespace', () => {
      const policy = new BasePolicy('order');
      expect(policy.namespace).toBe('order');
      expect(policy.getPermissions()).toEqual([]);
    });
  });

  describe('define', () => {
    it('registers a permission and returns it', () => {
      const policy = new BasePolicy('order');
      const perm = policy.define({ action: 'order:create', roles: ['driver', 'customer'] });
      expect(perm.action).toBe('order:create');
      expect(policy.getPermissions()).toHaveLength(1);
    });

    it('registers multiple permissions', () => {
      const policy = new BasePolicy('order');
      policy.define({ action: 'order:create', roles: ['driver'] });
      policy.define({ action: 'order:view', roles: ['driver', 'customer'] });
      expect(policy.getPermissions()).toHaveLength(2);
    });
  });

  describe('getPermissions', () => {
    it('returns a copy of the permissions array', () => {
      const policy = new BasePolicy('driver');
      policy.define({ action: 'driver:update', roles: ['driver'] });
      const perms = policy.getPermissions();
      perms.push('fake');
      expect(policy.getPermissions()).toHaveLength(1);
    });
  });

  describe('toMap', () => {
    it('returns a Map of action to Permission', () => {
      const policy = new BasePolicy('driver');
      policy.define({ action: 'driver:view', roles: ['driver'] });
      policy.define({ action: 'driver:update', roles: ['driver'] });
      const map = policy.toMap();
      expect(map).toBeInstanceOf(Map);
      expect(map.get('driver:view')).toBeDefined();
      expect(map.get('driver:update')).toBeDefined();
      expect(map.get('driver:missing')).toBeUndefined();
    });
  });
});
