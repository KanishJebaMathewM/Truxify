import { describe, it, expect } from 'vitest';
import { ROLES, isValidRole, allRoles } from '../../../../src/core/auth/Role.js';

// The Role class (addPermission/hasPermission) was removed in the
// policy-engine redesign — Role.js now exports the frozen ROLES constants and
// validation helpers. These tests pin the current contract.
describe('Role constants', () => {
  it('exposes the canonical role strings', () => {
    expect(ROLES).toEqual(Object.freeze({
      CUSTOMER: 'customer',
      DRIVER: 'driver',
      ADMIN: 'admin',
    }));
    expect(Object.isFrozen(ROLES)).toBe(true);
  });

  it('validates known roles and rejects unknown ones', () => {
    expect(isValidRole('customer')).toBe(true);
    expect(isValidRole('driver')).toBe(true);
    expect(isValidRole('admin')).toBe(true);
    expect(isValidRole('superuser')).toBe(false);
    expect(isValidRole('')).toBe(false);
    expect(isValidRole(null)).toBe(false);
    expect(isValidRole(42)).toBe(false);
  });

  it('lists all roles', () => {
    expect(allRoles()).toEqual(['customer', 'driver', 'admin']);
  });
});
