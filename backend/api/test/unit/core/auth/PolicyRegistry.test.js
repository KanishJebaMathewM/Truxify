import { describe, it, expect } from 'vitest';
import PolicyRegistry, { registry } from '../../../../src/core/auth/PolicyRegistry.js';
import { Permission } from '../../../../src/core/auth/Permission.js';

describe('PolicyRegistry', () => {
  it('registers a Permission instance', () => {
    const reg = new PolicyRegistry();
    const perm = new Permission({ action: 'order:read', roles: ['customer'] });
    reg.register(perm);
    expect(reg.get('order:read')).toBe(perm);
  });

  it('constructs a Permission from a plain object', () => {
    const reg = new PolicyRegistry();
    reg.register({ action: 'order:create', roles: ['customer'] });
    expect(reg.get('order:create')).toBeInstanceOf(Permission);
  });

  it('throws when registering a duplicate action', () => {
    const reg = new PolicyRegistry();
    reg.register({ action: 'order:read', roles: ['customer'] });
    expect(() =>
      reg.register({ action: 'order:read', roles: ['driver'] })
    ).toThrow(/already registered/);
  });

  it('registerAll registers every permission', () => {
    const reg = new PolicyRegistry();
    reg.registerAll([
      { action: 'a:read', roles: ['admin'] },
      { action: 'b:read', roles: ['admin'] },
    ]);
    expect(reg.size).toBe(2);
  });

  it('registerPolicy registers permissions from a BasePolicy module', () => {
    const reg = new PolicyRegistry();
    const policyModule = {
      getPermissions: () => [
        { action: 'truck:register', roles: ['driver'] },
      ],
    };
    reg.registerPolicy(policyModule);
    expect(reg.has('truck:register')).toBe(true);
  });

  it('has returns false for unregistered actions', () => {
    const reg = new PolicyRegistry();
    expect(reg.has('nope:read')).toBe(false);
  });

  it('listActions returns sorted action names', () => {
    const reg = new PolicyRegistry();
    reg.registerAll([
      { action: 'zeta:read', roles: ['admin'] },
      { action: 'alpha:read', roles: ['admin'] },
    ]);
    expect(reg.listActions()).toEqual(['alpha:read', 'zeta:read']);
  });

  it('listPermissions returns all registered permissions', () => {
    const reg = new PolicyRegistry();
    reg.register({ action: 'a:read', roles: ['admin'] });
    reg.register({ action: 'b:read', roles: ['admin'] });
    const perms = reg.listPermissions();
    expect(perms).toHaveLength(2);
    expect(perms[0]).toBeInstanceOf(Permission);
  });

  it('snapshot returns a serializable summary', () => {
    const reg = new PolicyRegistry();
    reg.register({ action: 'order:read', roles: ['customer'] });
    const snap = reg.snapshot();
    expect(snap.totalPermissions).toBe(1);
    expect(snap.policies['order:read']).toBeDefined();
  });

  it('exports a default singleton registry', () => {
    expect(registry).toBeInstanceOf(PolicyRegistry);
  });
});
