import { describe, it, expect } from 'vitest';
import { BasePolicy } from '../../../../src/core/auth/BasePolicy.js';
import { Permission } from '../../../../src/core/auth/Permission.js';

describe('BasePolicy', () => {
  it('throws without a namespace', () => {
    expect(() => new BasePolicy()).toThrow(/namespace/);
    expect(() => new BasePolicy('')).toThrow(/namespace/);
  });

  it('stores the namespace', () => {
    const policy = new BasePolicy('order');
    expect(policy.namespace).toBe('order');
  });

  it('define creates and returns a Permission', () => {
    const policy = new BasePolicy('order');
    const perm = policy.define({ action: 'order:read', roles: ['customer'] });
    expect(perm).toBeInstanceOf(Permission);
    expect(perm.action).toBe('order:read');
  });

  it('getPermissions returns a copy of the defined permissions', () => {
    const policy = new BasePolicy('order');
    policy.define({ action: 'order:read', roles: ['customer'] });
    policy.define({ action: 'order:cancel', roles: ['customer'] });

    const perms = policy.getPermissions();
    expect(perms).toHaveLength(2);
    // Mutating the returned array must not affect the policy.
    perms.pop();
    expect(policy.getPermissions()).toHaveLength(2);
  });

  it('toMap maps action to Permission', () => {
    const policy = new BasePolicy('order');
    policy.define({ action: 'order:read', roles: ['customer'] });
    const map = policy.toMap();
    expect(map.get('order:read')).toBeInstanceOf(Permission);
    expect(map.has('order:cancel')).toBe(false);
  });
});
