import { describe, it, expect } from 'vitest';
import { Permission } from '../../../../src/core/auth/Permission.js';

describe('Permission', () => {
  it('should create a permission with a resource and action', () => {
    const perm = new Permission('orders', 'create');
    expect(perm.resource).toBe('orders');
    expect(perm.action).toBe('create');
  });

  it('should generate a string representation', () => {
    const perm = new Permission('drivers', 'read');
    expect(perm.toString()).toBe('drivers:read');
  });

  it('should be equal to another permission with the same resource and action', () => {
    const perm1 = new Permission('orders', 'update');
    const perm2 = new Permission('orders', 'update');
    expect(perm1.equals(perm2)).toBe(true);
  });

  it('should not be equal to a permission with different resource', () => {
    const perm1 = new Permission('orders', 'delete');
    const perm2 = new Permission('drivers', 'delete');
    expect(perm1.equals(perm2)).toBe(false);
  });

  it('should handle wildcard action', () => {
    const perm = new Permission('orders', '*');
    expect(perm.action).toBe('*');
    expect(perm.toString()).toBe('orders:*');
  });
});
