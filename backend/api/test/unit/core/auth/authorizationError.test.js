import { describe, it, expect } from 'vitest';
import { AuthorizationError } from '../../../../src/core/auth/AuthorizationError.js';
// backend/api/test/unit/auth/authorization.test.js

import { describe, it, expect } from 'vitest';
import { AuthorizationError } from '../../../src/errors/AuthorizationError.js';
import { Role, Permission, hasPermission } from '../../../src/auth/roles.js';

describe('Authorization Primitives & Error Unit Tests - #9683', () => {
  
  describe('AuthorizationError', () => {
    it('correctly instantiates with default 403 status code and message', () => {
      const error = new AuthorizationError('Access denied');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AuthorizationError);
      expect(error.message).toBe('Access denied');
      expect(error.statusCode).toBe(403);
      expect(error.name).toBe('AuthorizationError');
    });
  });

  describe('Role and Permission Primitives', () => {
    it('defines standard system roles correctly', () => {
      expect(Role.ADMIN).toBeDefined();
      expect(Role.DRIVER).toBeDefined();
      expect(Role.CUSTOMER).toBeDefined();
    });

    it('correctly validates permissions assigned to roles', () => {
      // Example: Admin should have permissions to delete users or manage fleet
      const adminHasPermission = hasPermission(Role.ADMIN, Permission.MANAGE_FLEET);
      expect(adminHasPermission).toBe(true);

      // Example: Customer should not have driver management permissions
      const customerHasPermission = hasPermission(Role.CUSTOMER, Permission.MANAGE_FLEET);
      expect(customerHasPermission).toBe(false);
    });

    it('handles unknown roles or permissions gracefully', () => {
      const result = hasPermission('UNKNOWN_ROLE', Permission.VIEW_PROFILE);
      expect(result).toBe(false);
    });
  });
});
describe('AuthorizationError', () => {
  it('should create an error with a message', () => {
    // Current contract: (status, message, errorCode?) with errorCode +
    // status properties and _inferCode defaulting.
    const error = new AuthorizationError(403, 'Not authorized');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AuthorizationError);
    expect(error.message).toBe('Not authorized');
    expect(error.status).toBe(403);
    expect(error.errorCode).toBe('FORBIDDEN');
  });

  it('should have AuthorizationError as name', () => {
    const error = new AuthorizationError('Forbidden');
    expect(error.name).toBe('AuthorizationError');
  });

  it('should have the code property set when provided', () => {
    const error = new AuthorizationError(403, 'Access denied', 'ERR_ACCESS_DENIED');
    expect(error.errorCode).toBe('ERR_ACCESS_DENIED');
  });

  it('should default code to undefined when not provided', () => {
    const error = new AuthorizationError('No access');
    expect(error.code).toBeUndefined();
  });

  it('should capture a stack trace', () => {
    const error = new AuthorizationError('Stack trace test');
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('AuthorizationError');
  });
});
