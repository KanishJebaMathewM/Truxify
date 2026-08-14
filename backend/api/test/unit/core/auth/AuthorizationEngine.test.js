import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the PolicyEvaluator to isolate AuthorizationEngine
vi.mock('../../../../src/core/auth/PolicyEvaluator.js', () => ({
  PolicyEvaluator: vi.fn().mockImplementation(function MockEvaluator() {
    this.evaluate = vi.fn();
    this.authorize = vi.fn();
  }),
}));

// Mock PolicyRegistry
vi.mock('../../../../src/core/auth/PolicyRegistry.js', () => ({
  registry: {},
  PolicyRegistry: vi.fn(),
}));

// Mock AuthorizationError
vi.mock('../../../../src/core/auth/AuthorizationError.js', () => ({
  AuthorizationError: class AuthorizationError extends Error {
    constructor(message) {
      super(message);
      this.name = 'AuthorizationError';
    }
  },
}));

import { AuthorizationEngine } from '../../../../src/core/auth/AuthorizationEngine.js';

describe('AuthorizationEngine', () => {
  let engine;
  let mockEvaluator;

  beforeEach(() => {
    vi.clearAllMocks();
    // Create engine with mocked dependencies
    engine = new AuthorizationEngine({});
    mockEvaluator = engine.evaluator;
  });

  describe('evaluate()', () => {
    it('returns allowed=true when evaluator allows', () => {
      mockEvaluator.evaluate.mockReturnValue({ allowed: true });

      const user = { id: 'user-1', role: 'driver' };
      const result = engine.evaluate(user, 'order:view');

      expect(result).toEqual({ allowed: true });
    });

    it('returns allowed=false with reason when evaluator denies', () => {
      mockEvaluator.evaluate.mockReturnValue({ allowed: false, reason: 'Not authorized' });

      const user = { id: 'user-1', role: 'driver' };
      const result = engine.evaluate(user, 'order:delete');

      expect(result).toEqual({ allowed: false, reason: 'Not authorized' });
    });

    it('passes resource to evaluator', () => {
      mockEvaluator.evaluate.mockReturnValue({ allowed: true });
      const user = { id: 'user-1' };
      const resource = { order: { customer_id: 'user-1' } };

      engine.evaluate(user, 'order:view', resource);

      expect(mockEvaluator.evaluate).toHaveBeenCalledWith(user, 'order:view', resource);
    });
  });

  describe('authorize()', () => {
    it('returns result when evaluator allows', () => {
      mockEvaluator.authorize.mockReturnValue({ allowed: true });

      const user = { id: 'user-1', role: 'admin' };
      const result = engine.authorize(user, 'order:create');

      expect(result).toEqual({ allowed: true });
    });

    it('throws AuthorizationError when evaluator denies', () => {
      const authError = new Error('Forbidden');
      authError.name = 'AuthorizationError';
      mockEvaluator.authorize.mockImplementation(() => { throw authError; });

      const user = { id: 'user-1' };
      expect(() => engine.authorize(user, 'order:delete')).toThrow('Forbidden');
    });
  });

  describe('isRoleAllowed()', () => {
    it('returns true when role is allowed for action', () => {
      engine.registry.get = vi.fn().mockReturnValue({
        isRoleAllowed: vi.fn().mockReturnValue(true),
      });

      const result = engine.isRoleAllowed('order:view', 'driver');
      expect(result).toBe(true);
    });

    it('returns false when no permission found', () => {
      engine.registry.get = vi.fn().mockReturnValue(null);

      const result = engine.isRoleAllowed('nonexistent:action', 'driver');
      expect(result).toBe(false);
    });
  });

  describe('getRegisteredActions()', () => {
    it('delegates to registry.listActions()', () => {
      engine.registry.listActions = vi.fn().mockReturnValue(['order:view', 'order:create']);

      const actions = engine.getRegisteredActions();
      expect(actions).toEqual(['order:view', 'order:create']);
    });
  });
});
