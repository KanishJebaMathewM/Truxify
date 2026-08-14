import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PolicyEvaluator } from '../../src/core/auth/PolicyEvaluator.js';
import { PolicyRegistry } from '../../src/core/auth/PolicyRegistry.js';
import { Permission } from '../../src/core/auth/Permission.js';
import { AuthorizationError } from '../../src/core/auth/AuthorizationError.js';

vi.mock('../../src/core/auth/authorizationLogger.js', () => ({
  logAuthGrant: vi.fn(),
  logAuthDenial: vi.fn(),
}));

describe('PolicyEvaluator', () => {
  let registry;
  let evaluator;

  beforeEach(() => {
    registry = new PolicyRegistry();
    registry.register(new Permission({ action: 'order:view', roles: ['driver', 'customer', 'admin'] }));
    registry.register(new Permission({ action: 'order:delete', roles: ['admin'] }));
    evaluator = new PolicyEvaluator(registry);
  });

  describe('evaluate', () => {
    it('throws if user is missing', () => {
      expect(() => evaluator.evaluate(null, 'order:view')).toThrow(AuthorizationError);
    });

    it('throws if user.role is missing', () => {
      expect(() => evaluator.evaluate({ id: 'u1' }, 'order:view')).toThrow(AuthorizationError);
    });

    it('throws if action is not registered', () => {
      const user = { id: 'u1', role: 'driver' };
      expect(() => evaluator.evaluate(user, 'order:unknown')).toThrow(AuthorizationError);
    });

    it('returns allowed: false when role is not permitted', () => {
      const user = { id: 'u1', role: 'driver' };
      const result = evaluator.evaluate(user, 'order:delete');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not permitted');
    });

    it('returns allowed: true when role is permitted', () => {
      const user = { id: 'u1', role: 'driver' };
      const result = evaluator.evaluate(user, 'order:view');
      expect(result.allowed).toBe(true);
      expect(result.permission).toBeDefined();
    });

    it('returns allowed: false for ownership failure when resource is provided', () => {
      const user = { id: 'u1', role: 'customer' };
      const resource = { owner_id: 'u2' };
      const perm = new Permission({
        action: 'order:edit',
        roles: ['customer'],
        ownership: (u, r) => r.owner_id === u.id,
      });
      registry.register(perm);
      evaluator = new PolicyEvaluator(registry);
      const result = evaluator.evaluate(user, 'order:edit', resource);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('ownership');
    });
  });

  describe('authorize', () => {
    it('does not throw when allowed', () => {
      const user = { id: 'u1', role: 'driver' };
      expect(() => evaluator.authorize(user, 'order:view')).not.toThrow();
    });

    it('throws AuthorizationError when denied', () => {
      const user = { id: 'u1', role: 'driver' };
      expect(() => evaluator.authorize(user, 'order:delete')).toThrow(AuthorizationError);
    });
  });
});
