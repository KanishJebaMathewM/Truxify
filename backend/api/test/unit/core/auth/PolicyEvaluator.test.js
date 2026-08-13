import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyEvaluator } from '../../../../src/core/auth/PolicyEvaluator.js';
import { PolicyRegistry } from '../../../../src/core/auth/PolicyRegistry.js';
import { AuthorizationError } from '../../../../src/core/auth/AuthorizationError.js';

function buildEvaluator() {
  const registry = new PolicyRegistry();
  registry.register({
    action: 'order:read',
    roles: ['customer', 'driver'],
    ownership: (user, resource) => user.id === resource?.customerId,
  });
  registry.register({ action: 'health:read', roles: [] });
  return new PolicyEvaluator(registry);
}

describe('PolicyEvaluator', () => {
  let evaluator;

  beforeEach(() => {
    evaluator = buildEvaluator();
  });

  it('allows a role in the allow-list', () => {
    const result = evaluator.evaluate({ id: 'u1', role: 'customer' }, 'order:read');
    expect(result.allowed).toBe(true);
    expect(result.permission.action).toBe('order:read');
  });

  it('denies a role not in the allow-list', () => {
    const result = evaluator.evaluate({ id: 'u1', role: 'admin' }, 'order:read');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("'admin'");
  });

  it('allows any authenticated role when the roles list is empty', () => {
    expect(evaluator.evaluate({ id: 'u1', role: 'anything' }, 'health:read').allowed).toBe(true);
  });

  it('throws AuthorizationError when the user is missing', () => {
    expect(() => evaluator.evaluate(null, 'order:read')).toThrow(AuthorizationError);
    expect(() => evaluator.evaluate({ id: 'u1' }, 'order:read')).toThrow(AuthorizationError);
  });

  it('throws AuthorizationError for an unknown action', () => {
    expect(() => evaluator.evaluate({ id: 'u1', role: 'customer' }, 'nope:read')).toThrow(AuthorizationError);
  });

  it('enforces ownership when the resource is supplied', () => {
    const owner = evaluator.evaluate(
      { id: 'u1', role: 'customer' },
      'order:read',
      { customerId: 'u1' },
    );
    expect(owner.allowed).toBe(true);

    const stranger = evaluator.evaluate(
      { id: 'u2', role: 'customer' },
      'order:read',
      { customerId: 'u1' },
    );
    expect(stranger.allowed).toBe(false);
    expect(stranger.reason).toContain('ownership');
  });

  it('skips the ownership check when no resource is supplied', () => {
    const result = evaluator.evaluate({ id: 'u2', role: 'customer' }, 'order:read');
    expect(result.allowed).toBe(true);
  });

  it('authorize throws AuthorizationError on denial', () => {
    expect(() => evaluator.authorize({ id: 'u1', role: 'admin' }, 'order:read')).toThrow(AuthorizationError);
    expect(() => evaluator.authorize({ id: 'u1', role: 'customer' }, 'nope:read')).toThrow(AuthorizationError);
  });

  it('authorize returns the result when allowed', () => {
    const result = evaluator.authorize({ id: 'u1', role: 'customer' }, 'health:read');
    expect(result.allowed).toBe(true);
  });
});
