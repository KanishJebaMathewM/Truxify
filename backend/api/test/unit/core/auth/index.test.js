import { describe, it, expect, vi } from 'vitest';
import {
  ROLES,
  isValidRole,
  allRoles,
  Permission,
  BasePolicy,
  PolicyRegistry,
  registry,
  PolicyEvaluator,
  AuthorizationError,
  AuthorizationEngine,
  authorizationEngine,
  logAuthGrant,
  logAuthDenial,
  logUnknownAction,
  logAuthFailure,
  createRequestAuthLogger,
} from '../../../../src/core/auth/index.js';

vi.mock('../../../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('core/auth barrel exports', () => {
  it('exports the role constants and helpers', () => {
    expect(ROLES).toEqual({ CUSTOMER: 'customer', DRIVER: 'driver', ADMIN: 'admin' });
    expect(isValidRole('customer')).toBe(true);
    expect(isValidRole('superuser')).toBe(false);
    expect(allRoles()).toEqual(['customer', 'driver', 'admin']);
  });

  it('exports the permission and policy classes', () => {
    expect(typeof Permission).toBe('function');
    expect(typeof BasePolicy).toBe('function');
    expect(typeof PolicyRegistry).toBe('function');
    expect(typeof PolicyEvaluator).toBe('function');
    expect(typeof AuthorizationError).toBe('function');
    expect(typeof AuthorizationEngine).toBe('function');
  });

  it('exports the shared registry and engine singletons', () => {
    expect(registry).toBeInstanceOf(PolicyRegistry);
    expect(authorizationEngine).toBeInstanceOf(AuthorizationEngine);
  });

  it('exports the authorization logger helpers', () => {
    expect(typeof logAuthGrant).toBe('function');
    expect(typeof logAuthDenial).toBe('function');
    expect(typeof logUnknownAction).toBe('function');
    expect(typeof logAuthFailure).toBe('function');
    expect(typeof createRequestAuthLogger).toBe('function');
  });
});
