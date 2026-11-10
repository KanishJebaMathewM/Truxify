import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/core/auth/Permission.js', () => ({
  Permission: class MockPermission {
    constructor(opts) { this.action = opts.action; this.roles = opts.roles; }
  }
}));

const { BasePolicy } = await import('../../src/core/auth/BasePolicy.js');

describe('BasePolicy', () => {
  describe('constructor', () => {
    it('requires a non-empty namespace string', () => {
      expect(() => new BasePolicy()).toThrow('BasePolicy requires a non-empty namespace string.');
      expect(() => new BasePolicy('')).toThrow();
      expect(() => new BasePolicy(42)).toThrow();
    });

    it('stores the namespace', () => {
      expect(new BasePolicy('order').namespace).toBe('order');
    });
  });

  describe('define + getPermissions', () => {
    it('registers permissions and returns them', () => {
      const policy = new BasePolicy('order');
      policy.define({ action: 'order:read', roles: ['customer'] });
      policy.define({ action: 'order:write', roles: ['admin'] });
      const perms = policy.getPermissions();
      expect(perms).toHaveLength(2);
      expect(perms[0]).toHaveProperty('action', 'order:read');
      expect(perms[1]).toHaveProperty('roles', ['admin']);
    });

    it('returns a defensive copy (mutation does not leak into the policy)', () => {
      const policy = new BasePolicy('order');
      policy.define({ action: 'order:read', roles: ['customer'] });
      policy.getPermissions().length = 0;
      expect(policy.getPermissions()).toHaveLength(1);
    });
  });

  describe('toMap', () => {
    it('maps action -> Permission', () => {
      const policy = new BasePolicy('driver');
      policy.define({ action: 'driver:ping', roles: ['driver'] });
      const map = policy.toMap();
      expect(map.get('driver:ping')).toHaveProperty('action', 'driver:ping');
      expect(map.has('driver:nope')).toBe(false);
    });
  });
});
