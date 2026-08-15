/**
 * Unit tests for backend/api/src/core/auth/PolicyEvaluator.js
 *
 * Coverage:
 *   - constructor: accepts registry
 *   - evaluate: returns { allowed: true } for permitted action
 *   - evaluate: returns { allowed: false } for unknown action
 *   - evaluate: returns { allowed: false } for unregistered action
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PolicyEvaluator } from '../../src/core/auth/PolicyEvaluator.js';

vi.mock('../../src/core/auth/Permission.js', () => ({
  Permission: class MockPermission {
    constructor(opts) { this.action = opts.action; this.roles = opts.roles; }
    isRoleAllowed(role) { return this.roles.includes(role); }
  },
}));

describe('PolicyEvaluator', () => {
  let evaluator;
  let mockRegistry;

  beforeEach(() => {
    mockRegistry = { get: vi.fn(), has: vi.fn() };
    evaluator = new PolicyEvaluator(mockRegistry);
  });

  describe('constructor', () => {
    it('accepts registry', () => { expect(evaluator.registry).toBe(mockRegistry); });
  });

  describe('evaluate', () => {
    it('returns { allowed: true } for permitted action', () => {
      mockRegistry.get.mockReturnValue({ action: 'order:view', roles: ['admin', 'customer'], isRoleAllowed: (role) => ['admin', 'customer'].includes(role) });
      expect(evaluator.evaluate({ id: '1', role: 'admin' }, 'order:view').allowed).toBe(true);
    });

    it('returns { allowed: false } for unknown action', () => {
      mockRegistry.get.mockReturnValue(null);
      expect(evaluator.evaluate({ id: '1', role: 'admin' }, 'unknown:action').allowed).toBe(false);
    });

    it('returns { allowed: false } for unregistered action', () => {
      mockRegistry.has.mockReturnValue(false);
      expect(evaluator.evaluate({ id: '1', role: 'admin' }, 'order:delete').allowed).toBe(false);
    });
  });
});
