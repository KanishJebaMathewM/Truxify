/**
 * Unit tests for backend/api/src/core/auth/AuthorizationEngine.js
 *
 * Coverage:
 *   - constructor: uses default registry when none provided
 *   - constructor: accepts custom registry
 *   - evaluate: returns { allowed: true } when permission granted
 *   - evaluate: returns { allowed: false } when permission denied
 *   - evaluate: re-throws non-AuthorizationError exceptions
 *   - authorize: calls evaluator authorize when allowed
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }));
vi.mock('../../src/core/auth/authorizationLogger.js', () => ({ logAuthGrant: vi.fn(), logAuthDenial: vi.fn() }));

const mockEvaluate = vi.fn();
const mockAuthorize = vi.fn();
vi.mock('../../src/core/auth/PolicyEvaluator.js', () => ({
  PolicyEvaluator: class MockPolicyEvaluator {
    constructor(registry) { this.registry = registry; }
    evaluate(...args) { return mockEvaluate(...args); }
    authorize(...args) { return mockAuthorize(...args); }
  },
}));
vi.mock('../../src/core/auth/PolicyRegistry.js', () => ({
  PolicyRegistry: class MockPolicyRegistry {
    constructor() { this._permissions = new Map(); }
    get(action) { return this._permissions.get(action); }
    has(action) { return this._permissions.has(action); }
    register() {}
    listActions() { return []; }
  },
  registry: {},
}));
vi.mock('../../src/core/auth/AuthorizationError.js', () => ({
  AuthorizationError: class AuthorizationError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  },
}));

const AuthorizationEngine = (await import('../../src/core/auth/AuthorizationEngine.js')).AuthorizationEngine;

describe('AuthorizationEngine', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe('constructor', () => {
    it('creates engine with default registry', () => {
      const engine = new AuthorizationEngine();
      expect(engine).toBeTruthy();
      expect(engine.registry).toBeTruthy();
    });

    it('creates engine with custom registry', () => {
      const engine = new AuthorizationEngine({ name: 'custom' });
      expect(engine.registry).toEqual({ name: 'custom' });
    });
  });

  describe('evaluate', () => {
    it('returns { allowed: true } when permission granted', () => {
      mockEvaluate.mockReturnValue({ allowed: true });
      expect(new AuthorizationEngine().evaluate({ id: '1', role: 'admin' }, 'order:view').allowed).toBe(true);
    });

    it('returns { allowed: false } when permission denied', () => {
      mockEvaluate.mockReturnValue({ allowed: false, reason: 'not allowed' });
      expect(new AuthorizationEngine().evaluate({ id: '1', role: 'driver' }, 'admin:dashboard').allowed).toBe(false);
    });

    it('re-throws non-AuthorizationError exceptions', () => {
      mockEvaluate.mockImplementation(() => { throw new Error('some error'); });
      expect(() => new AuthorizationEngine().evaluate({ id: '1', role: 'driver' }, 'order:view')).toThrow('some error');
    });
  });

  describe('authorize', () => {
    it('calls evaluator authorize when allowed', () => {
      mockAuthorize.mockReturnValue(undefined);
      new AuthorizationEngine().authorize({ id: '1', role: 'admin' }, 'order:view');
      expect(mockAuthorize).toHaveBeenCalled();
    });
  });
});
