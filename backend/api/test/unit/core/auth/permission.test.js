import { describe, it, expect } from 'vitest';
import { Permission } from '../../../../src/core/auth/Permission.js';

// The policy-engine Permission takes an options object ({ action, roles,
// ownership, description }) — the positional (resource, action) constructor,
// .equals and .toString were removed in the redesign.
describe('Permission', () => {
  it('creates a permission with an action', () => {
    const perm = new Permission({ action: 'order:create' });
    expect(perm.action).toBe('order:create');
  });

  it('rejects a missing or non-string action', () => {
    expect(() => new Permission({})).toThrow('non-empty action');
    expect(() => new Permission({ action: 42 })).toThrow('non-empty action');
  });

  it('freezes the roles list and allows any role when empty', () => {
    const perm = new Permission({ action: 'order:read' });
    expect(perm.isRoleAllowed('customer')).toBe(true);
    expect(perm.isRoleAllowed('driver')).toBe(true);

    const restricted = new Permission({ action: 'admin:manage', roles: ['admin'] });
    expect(restricted.isRoleAllowed('admin')).toBe(true);
    expect(restricted.isRoleAllowed('customer')).toBe(false);
    expect(Object.isFrozen(restricted.roles)).toBe(true);
  });

  it('serializes to JSON with action, roles, and description', () => {
    const perm = new Permission({ action: 'order:read', roles: ['customer'], description: 'View orders' });
    expect(perm.toJSON()).toEqual({
      action: 'order:read',
      roles: ['customer'],
      hasOwnershipCheck: false,
      description: 'View orders',
    });
  });

  it('checks ownership via the ownership callback', () => {
    const perm = new Permission({
      action: 'order:cancel',
      roles: ['customer'],
      ownership: (user, order) => order.customer_id === user.id,
    });
    expect(perm.checkOwnership({ id: 'u-1' }, { customer_id: 'u-1' })).toBe(true);
    expect(perm.checkOwnership({ id: 'u-1' }, { customer_id: 'other' })).toBe(false);
    // No ownership callback means "no additional resource restriction".
    const open = new Permission({ action: 'order:create' });
    expect(open.checkOwnership({ id: 'u-1' }, {})).toBe(true);
  });
});
