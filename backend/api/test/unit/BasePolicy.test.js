import { describe, it, expect } from 'vitest';
import { BasePolicy } from '../../../../src/core/auth/BasePolicy.js';

describe('BasePolicy', () => {
  it('can be extended with evaluate method', () => {
    class TestPolicy extends BasePolicy {
      evaluate(context) {
        return context.user === 'admin';
      }
    }
    const policy = new TestPolicy({ name: 'TestPolicy' });
    expect(policy.name).toBe('TestPolicy');
    expect(policy.evaluate({ user: 'admin' })).toBe(true);
    expect(policy.evaluate({ user: 'guest' })).toBe(false);
  });
});
