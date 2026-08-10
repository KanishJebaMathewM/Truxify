import { describe, it, expect, beforeEach } from 'vitest';
import { ROLES as Role, isValidRole, allRoles } from '../../src/core/auth/Role.js';
import { Permission } from '../../src/core/auth/Permission.js';
import { BasePolicy } from '../../src/core/auth/BasePolicy.js';
import { PolicyRegistry } from '../../src/core/auth/PolicyRegistry.js';
import { PolicyEvaluator } from '../../src/core/auth/PolicyEvaluator.js';
import { AuthorizationError } from '../../src/core/auth/AuthorizationError.js';
import { AuthorizationEngine } from '../../src/core/auth/AuthorizationEngine.js';

function user(role, id = 'user-1') {
  return { id, role };
}

describe('Core Auth Module', () => {
  describe('ROLES', () => {
    it('defines customer, driver, admin roles', () => {
      expect(Role.CUSTOMER).toBe('customer');
      expect(Role.DRIVER).toBe('driver');
      expect(Role.ADMIN).toBe('admin');
    });

    it('isValidRole validates known roles', () => {
      expect(isValidRole('customer')).toBe(true);
      expect(isValidRole('driver')).toBe(true);
      expect(isValidRole('admin')).toBe(true);
      expect(isValidRole('superadmin')).toBe(false);
      expect(isValidRole(null)).toBe(false);
      expect(isValidRole(undefined)).toBe(false);
    });

    it('allRoles returns all role strings', () => {
      const roles = allRoles();
      expect(roles).toContain('customer');
      expect(roles).toContain('driver');
      expect(roles).toContain('admin');
      expect(roles.length).toBe(3);
    });
  });

  describe('Permission', () => {
    it('creates a permission with action only', () => {
      const perm = new Permission({ action: 'order:create' });
      expect(perm.action).toBe('order:create');
      expect(perm.roles).toEqual([]);
      expect(perm.ownership).toBeNull();
    });

    it('creates a permission with roles', () => {
      const perm = new Permission({ action: 'order:create', roles: ['customer'] });
      expect(perm.roles).toEqual(['customer']);
      expect(perm.isRoleAllowed('customer')).toBe(true);
      expect(perm.isRoleAllowed('driver')).toBe(false);
    });

    it('allows any role when roles array is empty', () => {
      const perm = new Permission({ action: 'ticket:create' });
      expect(perm.isRoleAllowed('customer')).toBe(true);
      expect(perm.isRoleAllowed('driver')).toBe(true);
      expect(perm.isRoleAllowed('admin')).toBe(true);
    });

    it('rejects missing role', () => {
      const perm = new Permission({ action: 'order:create', roles: ['customer'] });
      expect(perm.isRoleAllowed(null)).toBe(false);
      expect(perm.isRoleAllowed(undefined)).toBe(false);
    });

    it('evaluates ownership check', () => {
      const perm = new Permission({
        action: 'order:view',
        ownership: (u, r) => r?.order?.customer_id === u.id,
      });
      expect(perm.checkOwnership(user('customer', 'u1'), { order: { customer_id: 'u1' } })).toBe(true);
      expect(perm.checkOwnership(user('customer', 'u1'), { order: { customer_id: 'u2' } })).toBe(false);
    });

    it('returns true when no ownership check defined', () => {
      const perm = new Permission({ action: 'order:create', roles: ['customer'] });
      expect(perm.checkOwnership(user('customer'))).toBe(true);
    });

    it('throws on missing action', () => {
      expect(() => new Permission({})).toThrow('Permission requires a non-empty action string.');
    });

    it('serializes to JSON', () => {
      const perm = new Permission({ action: 'test', roles: ['admin'], description: 'test perm' });
      const json = perm.toJSON();
      expect(json.action).toBe('test');
      expect(json.roles).toEqual(['admin']);
      expect(json.description).toBe('test perm');
    });
  });

  describe('BasePolicy', () => {
    it('creates a policy module with namespace', () => {
      const policy = new BasePolicy('order');
      expect(policy.namespace).toBe('order');
    });

    it('defines permissions', () => {
      const policy = new BasePolicy('order');
      policy.define({ action: 'order:create', roles: ['customer'] });
      policy.define({ action: 'order:view', roles: ['customer', 'driver'] });
      expect(policy.getPermissions().length).toBe(2);
    });

    it('converts to action map', () => {
      const policy = new BasePolicy('order');
      policy.define({ action: 'order:create', roles: ['customer'] });
      const map = policy.toMap();
      expect(map.has('order:create')).toBe(true);
      expect(map.get('order:create').roles).toEqual(['customer']);
    });

    it('throws on empty namespace', () => {
      expect(() => new BasePolicy('')).toThrow();
    });
  });

  describe('PolicyRegistry', () => {
    let registry;

    beforeEach(() => {
      registry = new PolicyRegistry();
    });

    it('registers a permission', () => {
      registry.register({ action: 'order:create', roles: ['customer'] });
      expect(registry.has('order:create')).toBe(true);
      expect(registry.size).toBe(1);
    });

    it('rejects duplicate registrations', () => {
      registry.register({ action: 'order:create', roles: ['customer'] });
      expect(() => registry.register({ action: 'order:create', roles: ['driver'] }))
        .toThrow('Permission already registered for action: order:create');
    });

    it('registers all permissions from array', () => {
      registry.registerAll([
        { action: 'a', roles: ['admin'] },
        { action: 'b', roles: ['driver'] },
      ]);
      expect(registry.size).toBe(2);
    });

    it('registers from BasePolicy module', () => {
      const policy = new BasePolicy('order');
      policy.define({ action: 'order:create', roles: ['customer'] });
      registry.registerPolicy(policy);
      expect(registry.has('order:create')).toBe(true);
    });

    it('lists actions sorted', () => {
      registry.register({ action: 'b:view', roles: [] });
      registry.register({ action: 'a:create', roles: [] });
      expect(registry.listActions()).toEqual(['a:create', 'b:view']);
    });

    it('returns snapshot', () => {
      registry.register({ action: 'test', roles: ['admin'] });
      const snap = registry.snapshot();
      expect(snap.totalPermissions).toBe(1);
      expect(snap.policies.test.roles).toEqual(['admin']);
    });
  });

  describe('PolicyEvaluator', () => {
    let registry;
    let evaluator;

    beforeEach(() => {
      registry = new PolicyRegistry();
      registry.register({ action: 'order:create', roles: ['customer'] });
      registry.register({ action: 'order:view', roles: ['customer', 'driver', 'admin'], ownership: (u, r) => r?.order && (r.order.customer_id === u.id || r.order.driver_id === u.id || u.role === 'admin') });
      registry.register({ action: 'open:action', roles: [] });
      evaluator = new PolicyEvaluator(registry);
    });

    it('authorizes matching role', () => {
      const result = evaluator.evaluate(user('customer'), 'order:create');
      expect(result.allowed).toBe(true);
    });

    it('denies non-matching role', () => {
      const result = evaluator.evaluate(user('driver'), 'order:create');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not permitted');
    });

    it('allows any role for open actions', () => {
      expect(evaluator.evaluate(user('customer'), 'open:action').allowed).toBe(true);
      expect(evaluator.evaluate(user('driver'), 'open:action').allowed).toBe(true);
      expect(evaluator.evaluate(user('admin'), 'open:action').allowed).toBe(true);
    });

    it('checks ownership when resource provided', () => {
      const resource = { order: { customer_id: 'user-1', driver_id: null } };
      expect(evaluator.evaluate(user('customer', 'user-1'), 'order:view', resource).allowed).toBe(true);
      expect(evaluator.evaluate(user('customer', 'other'), 'order:view', resource).allowed).toBe(false);
    });

    it('allows admin to bypass ownership', () => {
      const resource = { order: { customer_id: 'other', driver_id: null } };
      expect(evaluator.evaluate(user('admin', 'admin-1'), 'order:view', resource).allowed).toBe(true);
    });

    it('throws AuthorizationError for unknown user', () => {
      expect(() => evaluator.authorize(null, 'order:create')).toThrow(AuthorizationError);
    });

    it('throws AuthorizationError for unknown action', () => {
      expect(() => evaluator.authorize(user('admin'), 'nonexistent:action')).toThrow(AuthorizationError);
    });

    it('throws on denied role via authorize()', () => {
      expect(() => evaluator.authorize(user('driver'), 'order:create')).toThrow(AuthorizationError);
    });

    it('does not throw on allowed action via authorize()', () => {
      expect(() => evaluator.authorize(user('customer'), 'order:create')).not.toThrow();
    });
  });

  describe('AuthorizationError', () => {
    it('creates error with status and message', () => {
      const err = new AuthorizationError(403, 'Forbidden');
      expect(err.status).toBe(403);
      expect(err.message).toBe('Forbidden');
      expect(err.name).toBe('AuthorizationError');
    });

    it('infers error code from status', () => {
      expect(new AuthorizationError(401, 'No auth').errorCode).toBe('UNAUTHENTICATED');
      expect(new AuthorizationError(403, 'Forbidden').errorCode).toBe('FORBIDDEN');
    });

    it('serializes to JSON', () => {
      const err = new AuthorizationError(403, 'Forbidden', 'CUSTOM_CODE');
      const json = err.toJSON();
      expect(json.status).toBe(403);
      expect(json.errorCode).toBe('CUSTOM_CODE');
    });
  });

  describe('AuthorizationEngine', () => {
    let registry;
    let engine;

    beforeEach(() => {
      registry = new PolicyRegistry();
      registry.register({ action: 'order:create', roles: ['customer'] });
      registry.register({ action: 'order:view', roles: ['customer', 'driver', 'admin'], ownership: (u, r) => r?.order && (r.order.customer_id === u.id || r.order.driver_id === u.id || u.role === 'admin') });
      registry.register({ action: 'admin:dashboard', roles: ['admin'] });
      engine = new AuthorizationEngine(registry);
    });

    it('evaluate returns allowed for valid action', () => {
      const result = engine.evaluate(user('customer'), 'order:create');
      expect(result.allowed).toBe(true);
    });

    it('evaluate returns denied for invalid role', () => {
      const result = engine.evaluate(user('driver'), 'order:create');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not permitted');
    });

    it('authorize throws on denial', () => {
      expect(() => engine.authorize(user('driver'), 'order:create')).toThrow(AuthorizationError);
    });

    it('authorize does not throw on success', () => {
      expect(() => engine.authorize(user('customer'), 'order:create')).not.toThrow();
    });

    it('isRoleAllowed checks roles without ownership', () => {
      expect(engine.isRoleAllowed('order:create', 'customer')).toBe(true);
      expect(engine.isRoleAllowed('order:create', 'driver')).toBe(false);
      expect(engine.isRoleAllowed('admin:dashboard', 'admin')).toBe(true);
    });

    it('getRegisteredActions returns sorted actions', () => {
      const actions = engine.getRegisteredActions();
      expect(actions).toContain('order:create');
      expect(actions).toContain('admin:dashboard');
    });

    it('getPolicySnapshot returns full snapshot', () => {
      const snap = engine.getPolicySnapshot();
      expect(snap.totalPolicies).toBe(3);
      expect(snap.policies['order:create'].roles).toEqual(['customer']);
    });
  });
});
