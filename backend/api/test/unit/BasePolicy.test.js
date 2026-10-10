import { describe, it, expect } from 'vitest';
import { BasePolicy } from '../../src/core/auth/BasePolicy.js';

describe('BasePolicy', () => {
  it('requires a non-empty namespace string', () => {
    expect(() => new BasePolicy()).toThrow(/namespace/i);
    expect(() => new BasePolicy('')).toThrow(/namespace/i);
    expect(() => new BasePolicy(42)).toThrow(/namespace/i);
    expect(() => new BasePolicy('test')).not.toThrow();
  });

  it('can be extended with an evaluate method', () => {
    class TestPolicy extends BasePolicy {
      constructor() {
        super('test');
      }
      evaluate(context) {
        return context.user === 'admin';
      }
    }
    const policy = new TestPolicy();
    expect(policy.namespace).toBe('test');
    expect(policy.evaluate({ user: 'admin' })).toBe(true);
    expect(policy.evaluate({ user: 'guest' })).toBe(false);
  });

  it('starts with no registered permissions', () => {
    const policy = new BasePolicy('test');
    expect(policy.getPermissions()).toEqual([]);
    expect(policy.toMap().size).toBe(0);
  });
});