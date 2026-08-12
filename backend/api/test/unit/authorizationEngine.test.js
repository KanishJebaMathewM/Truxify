import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthorizationEngine } from '../../src/core/auth/AuthorizationEngine.js';
import { PolicyRegistry } from '../../src/core/auth/PolicyRegistry.js';
import { Permission } from '../../src/core/auth/Permission.js';
import { AuthorizationError } from '../../src/core/auth/AuthorizationError.js';

vi.mock('../../src/core/auth/authorizationLogger.js', () => ({
  logAuthGrant: vi.fn(),
  logAuthDenial: vi.fn(),
}));

describe('AuthorizationEngine', () => {
  let engine;
  let mockRegistry;

  beforeEach(() => {
    vi.resetModules();
    mockRegistry = new PolicyRegistry();

    // Permission constructor: { action, roles, ownership, description }
    mockRegistry.register(new Permission({
      action: 'order:view',
      roles: ['driver', 'customer'],
    }));

    mockRegistry.register(new Permission({
      action: 'order:delete',
      roles: ['admin'],
    }));

    mockRegistry.register(new Permission({
      action: 'health:read',
      roles: ['driver', 'customer', 'admin'],
    }));

    engine = new AuthorizationEngine(mockRegistry);
  });

  describe('evaluate', () => {
    it('returns allowed: true when user role is in roles', () => {
      const result = engine.evaluate({ id: 'u1', role: 'driver' }, 'order:view', {});
      expect(result.allowed).toBe(true);
    });

    it('returns allowed: false when user role is not in roles', () => {
      const result = engine.evaluate({ id: 'u2', role: 'admin' }, 'order:view', {});
      expect(result.allowed).toBe(false);
    });

    it('returns allowed: true for health:read when user is customer', () => {
      const result = engine.evaluate({ id: 'u3', role: 'customer' }, 'health:read', {});
      expect(result.allowed).toBe(true);
    });

    it('returns allowed: false when action is not registered', () => {
      const result = engine.evaluate({ id: 'u4', role: 'admin' }, 'unknown:action', {});
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Unknown authorization action: unknown:action');
    });

    it('returns allowed: false when user is missing (evaluate catches AuthorizationError)', () => {
      const result = engine.evaluate(null, 'order:view', {});
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Not authenticated');
    });

    it('returns allowed: false when user has no role (evaluate catches AuthorizationError)', () => {
      const result = engine.evaluate({ id: 'u5' }, 'order:view', {});
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Not authenticated');
    });

    it('allows owner access via ownership function', () => {
      mockRegistry.register(new Permission({
        action: 'order:edit',
        roles: ['customer'],
        ownership: (user, resource) => resource && resource.customer_id === user.id,
      }));

      const user = { id: 'u6', role: 'customer' };
      const resource = { customer_id: 'u6' };
      const result = engine.evaluate(user, 'order:edit', resource);
      expect(result.allowed).toBe(true);
    });

    it('denies access when user is not the owner', () => {
      mockRegistry.register(new Permission({
        action: 'order:edit2',
        roles: ['customer'],
        ownership: (user, resource) => resource && resource.customer_id === user.id,
      }));

      const user = { id: 'u7', role: 'customer' };
      const resource = { customer_id: 'other-user' };
      const result = engine.evaluate(user, 'order:edit2', resource);
      expect(result.allowed).toBe(false);
    });

    it('returns allow result with reason string', () => {
      const result = engine.evaluate({ id: 'u8', role: 'admin' }, 'order:view', {});
      expect(result.allowed).toBe(false);
      expect(typeof result.reason).toBe('string');
    });
  });

  describe('authorize', () => {
    it('returns without throwing when user is allowed', () => {
      expect(() =>
        engine.authorize({ id: 'u9', role: 'driver' }, 'order:view', {}),
      ).not.toThrow();
    });

    it('throws AuthorizationError when user is denied', () => {
      expect(() =>
        engine.authorize({ id: 'u10', role: 'admin' }, 'order:view', {}),
      ).toThrow(AuthorizationError);
    });

    it('throws AuthorizationError when user is missing', () => {
      expect(() => engine.authorize(null, 'order:view', {})).toThrow(AuthorizationError);
    });

    it('throws AuthorizationError for unregistered action', () => {
      expect(() =>
        engine.authorize({ id: 'u11', role: 'admin' }, 'ghost:action', {}),
      ).toThrow(AuthorizationError);
    });
  });

  describe('isRoleAllowed', () => {
    it('returns true when role is in roles', () => {
      expect(engine.isRoleAllowed('order:view', 'driver')).toBe(true);
    });

    it('returns false when role is not in roles', () => {
      expect(engine.isRoleAllowed('order:view', 'admin')).toBe(false);
    });

    it('returns false for unregistered action', () => {
      expect(engine.isRoleAllowed('totally:unknown', 'admin')).toBe(false);
    });
  });

  describe('getPolicySnapshot', () => {
    it('returns an object with totalPolicies and policies', () => {
      const snapshot = engine.getPolicySnapshot();
      expect(typeof snapshot.totalPolicies).toBe('number');
      expect(typeof snapshot.policies).toBe('object');
      expect(snapshot.policies['order:view']).toBeTruthy();
    });

    it('includes registered action in policies map', () => {
      const snapshot = engine.getPolicySnapshot();
      expect(snapshot.policies['health:read']).toBeTruthy();
    });
  });

  describe('getRegisteredActions', () => {
    it('returns an array of registered action names', () => {
      const actions = engine.getRegisteredActions();
      expect(Array.isArray(actions)).toBe(true);
      expect(actions).toContain('order:view');
      expect(actions).toContain('order:delete');
      expect(actions).toContain('health:read');
    });
  });

  describe('constructor', () => {
    it('uses custom registry when provided', () => {
      const customReg = new PolicyRegistry();
      const customEngine = new AuthorizationEngine(customReg);
      expect(customEngine.registry).toBe(customReg);
    });

    it('uses default registry when none provided', () => {
      const defaultEngine = new AuthorizationEngine();
      expect(defaultEngine.registry).toBeTruthy();
    });
  });
});
