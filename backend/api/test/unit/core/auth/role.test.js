import { describe, it, expect } from 'vitest';
import { ROLES, isValidRole, allRoles } from '../../../../src/core/auth/Role.js';

describe('Role', () => {
  it('should define the application roles', () => {
    expect(ROLES).toEqual({ CUSTOMER: 'customer', DRIVER: 'driver', ADMIN: 'admin' });
  });

  it('should recognise valid roles', () => {
    expect(isValidRole('customer')).toBe(true);
    expect(isValidRole('driver')).toBe(true);
    expect(isValidRole('admin')).toBe(true);
  });

  it('should reject unknown roles', () => {
    expect(isValidRole('editor')).toBe(false);
    expect(isValidRole('')).toBe(false);
  });

  it('should reject non-string input', () => {
    expect(isValidRole(null)).toBe(false);
    expect(isValidRole(undefined)).toBe(false);
    expect(isValidRole(123)).toBe(false);
  });

  it('should return all valid roles', () => {
    expect(allRoles()).toEqual(['customer', 'driver', 'admin']);
  });
});
