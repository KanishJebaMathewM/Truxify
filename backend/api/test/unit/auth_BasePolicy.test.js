/**
 * Unit tests for backend/api/src/core/auth/BasePolicy.js
 *
 * Coverage:
 *   - getPermissions: returns array of permissions
 *   - getName: returns policy name
 *   - getVersion: returns version
 */
import { describe, it, expect, vi } from 'vitest';

const { BasePolicy } = await import('../../src/core/auth/BasePolicy.js');

class TestPolicy extends BasePolicy {
  static getPermissions() { return [{ action: 'test:read', roles: ['admin', 'user'] }, { action: 'test:write', roles: ['admin'] }]; }
  static getName() { return 'test-policy'; }
  static getVersion() { return '1.0.0'; }
}

describe('BasePolicy', () => {
  let policy;

  beforeEach(() => { policy = new TestPolicy(); });
  vi.mock('../../src/core/auth/Permission.js', () => ({ Permission: class MockPermission { constructor(opts) { this.action = opts.action; this.roles = opts.roles; } } }));

  describe('getPermissions', () => {
    it('returns array of permission objects', () => {
      const perms = policy.getPermissions();
      expect(Array.isArray(perms)).toBe(true);
      expect(perms.length).toBeGreaterThan(0);
    });

    it('permissions have action and roles', () => {
      const perms = policy.getPermissions();
      expect(perms[0]).toHaveProperty('action');
      expect(perms[0]).toHaveProperty('roles');
    });
  });

  describe('getName', () => {
    it('returns policy name', () => { expect(policy.getName()).toBe('test-policy'); });
  });

  describe('getVersion', () => {
    it('returns version string', () => { expect(policy.getVersion()).toBe('1.0.0'); });
  });
});
