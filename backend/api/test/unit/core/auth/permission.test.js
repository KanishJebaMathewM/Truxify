import { describe, it, expect } from 'vitest';
import { Permission } from '../../../../src/core/auth/Permission.js';

describe('Permission', () => {
  it('should create a permission with an action', () => {
    const perm = new Permission({ action: 'orders:create' });
    expect(perm.action).toBe('orders:create');
  });

  it('should store the allowed roles from the options object', () => {
    const perm = new Permission({ action: 'orders:create', roles: ['driver', 'admin'] });
    expect(perm.roles).toEqual(['driver', 'admin']);
  });

  it('should default roles to empty when not provided', () => {
    const perm = new Permission({ action: 'orders:create' });
    expect(perm.roles).toEqual([]);
  });

  it('should freeze the roles array', () => {
    const perm = new Permission({ action: 'orders:create', roles: ['driver'] });
    expect(Object.isFrozen(perm.roles)).toBe(true);
  });

  it('should store the description and ownership check', () => {
    const ownership = () => true;
    const perm = new Permission({ action: 'orders:create', ownership, description: 'Create an order' });
    expect(perm.description).toBe('Create an order');
    expect(perm.ownership).toBe(ownership);
  });

  it('should allow any authenticated role when no roles are listed', () => {
    const perm = new Permission({ action: 'orders:create' });
    expect(perm.isRoleAllowed('driver')).toBe(true);
    expect(perm.isRoleAllowed('customer')).toBe(true);
  });

  it('should allow only the roles in the allow-list', () => {
    const perm = new Permission({ action: 'orders:create', roles: ['driver'] });
    expect(perm.isRoleAllowed('driver')).toBe(true);
    expect(perm.isRoleAllowed('customer')).toBe(false);
  });

  it('should reject a missing role', () => {
    const perm = new Permission({ action: 'orders:create' });
    expect(perm.isRoleAllowed(null)).toBe(false);
    expect(perm.isRoleAllowed(undefined)).toBe(false);
  });

  it('should deny when the ownership check returns false', () => {
    const perm = new Permission({ action: 'orders:read', ownership: () => false });
    expect(perm.checkOwnership({ id: 'u1' }, { owner_id: 'u2' })).toBe(false);
  });

  it('should allow when the ownership check returns true', () => {
    const perm = new Permission({
      action: 'orders:read',
      ownership: (user, resource) => user.id === resource.owner_id,
    });
    expect(perm.checkOwnership({ id: 'u1' }, { owner_id: 'u1' })).toBe(true);
  });

  it('should allow access when no ownership check is defined', () => {
    const perm = new Permission({ action: 'orders:read' });
    expect(perm.checkOwnership({ id: 'u1' }, { owner_id: 'u2' })).toBe(true);
  });

  it('should throw when the action is missing', () => {
    expect(() => new Permission({})).toThrow('Permission requires a non-empty action string.');
  });

  it('should serialize via toJSON', () => {
    const perm = new Permission({ action: 'orders:create', roles: ['driver'], description: 'Create an order' });
    expect(perm.toJSON()).toEqual({
      action: 'orders:create',
      roles: ['driver'],
      hasOwnershipCheck: false,
      description: 'Create an order',
    });
  });
});
