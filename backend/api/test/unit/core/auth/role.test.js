import { describe, it, expect } from 'vitest';
import { Role } from '../../../../src/core/auth/Role.js';
import { Permission } from '../../../../src/core/auth/Permission.js';

describe('Role', () => {
  it('should create a role with a name', () => {
    const role = new Role('admin');
    expect(role.name).toBe('admin');
  });

  it('should add permissions to the role', () => {
    const role = new Role('editor');
    const perm = new Permission('articles', 'write');
    role.addPermission(perm);
    expect(role.hasPermission(perm)).toBe(true);
  });

  it('should check if role has a permission', () => {
    const role = new Role('viewer');
    role.addPermission(new Permission('orders', 'read'));
    expect(role.hasPermission(new Permission('orders', 'read'))).toBe(true);
    expect(role.hasPermission(new Permission('orders', 'write'))).toBe(false);
  });

  it('should support wildcard permissions', () => {
    const role = new Role('superuser');
    role.addPermission(new Permission('*', '*'));
    expect(role.hasPermission(new Permission('anything', 'any_action'))).toBe(true);
  });
});
