/**
 * AuthorizationEngine — the central facade for the Truxify authorization system.
 *
 * This engine ties together:
 * - PolicyRegistry (permission definitions)
 * - PolicyEvaluator (permission evaluation)
 * - authorizationLogger (structured audit logging)
 *
 * Usage:
 *   import { authorizationEngine } from './core/auth/index.js';
 *   authorizationEngine.authorize(user, 'order:create');
 *   authorizationEngine.evaluate(user, 'order:view', { order: { customer_id: user.id } });
 *
 * The engine is fully backward-compatible with the existing PolicyEngine singleton
 * used throughout the codebase. It delegates to the same POLICIES map while
 * adding logging, introspection, and registry capabilities.
 */

import { PolicyRegistry, registry } from './PolicyRegistry.js';
import { PolicyEvaluator } from './PolicyEvaluator.js';
import { AuthorizationError } from './AuthorizationError.js';
import { logAuthGrant, logAuthDenial } from './authorizationLogger.js';

export class AuthorizationEngine {
  /**
   * @param {PolicyRegistry} [customRegistry] - Optional custom registry (for testing)
   */
  constructor(customRegistry) {
    this.registry = customRegistry || registry;
    this.evaluator = new PolicyEvaluator(this.registry);
  }

  /**
   * Evaluate whether user can perform action on optional resource.
   * Returns { allowed, permission, reason } without throwing.
   *
   * @param {object}  user       - { id, role, ... }
   * @param {string}  action     - Policy action name
   * @param {object}  [resource] - Optional resource for ownership checks
   * @param {object}  [ctx]      - { requestId, startTime }
   * @returns {{ allowed: boolean, permission?: object, reason?: string }}
   */
  evaluate(user, action, resource, ctx = {}) {
    const startTime = ctx.startTime || Date.now();
    try {
      const result = this.evaluator.evaluate(user, action, resource);
      const durationMs = Date.now() - startTime;

      if (result.allowed) {
        logAuthGrant({ user, action, resource, requestId: ctx.requestId, durationMs });
      } else {
        logAuthDenial({ user, action, resource, reason: result.reason, requestId: ctx.requestId, durationMs });
      }

      return result;
    } catch (err) {
      if (err instanceof AuthorizationError) {
        const durationMs = Date.now() - startTime;
        logAuthDenial({ user, action, resource, reason: err.message, requestId: ctx.requestId, durationMs });
        return { allowed: false, reason: err.message };
      }
      throw err;
    }
  }

  /**
   * Authorize (throw on denial) — for middleware use.
   *
   * @param {object}  user
   * @param {string}  action
   * @param {object}  [resource]
   * @param {object}  [ctx]      - { requestId, startTime }
   * @throws {AuthorizationError}
   */
  authorize(user, action, resource, ctx = {}) {
    const startTime = ctx.startTime || Date.now();
    try {
      const result = this.evaluator.authorize(user, action, resource);
      const durationMs = Date.now() - startTime;
      logAuthGrant({ user, action, resource, requestId: ctx.requestId, durationMs });
      return result;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      if (err instanceof AuthorizationError) {
        logAuthDenial({ user, action, resource, reason: err.message, requestId: ctx.requestId, durationMs });
      }
      throw err;
    }
  }

  /**
   * Check whether a role is allowed for the given action (without ownership check).
   * Useful for quick role-based gate checks.
   */
  isRoleAllowed(action, role) {
    const permission = this.registry.get(action);
    if (!permission) return false;
    return permission.isRoleAllowed(role);
  }

  /**
   * Returns a snapshot of all registered policies (for admin/debug endpoints).
   */
  getPolicySnapshot() {
    const actions = this.registry.listActions();
    const policies = {};
    for (const action of actions) {
      const perm = this.registry.get(action);
      policies[action] = perm ? perm.toJSON() : {};
    }
    return {
      totalPolicies: actions.length,
      policies,
    };
  }

  /**
   * Returns all registered action names.
   */
  getRegisteredActions() {
    return this.registry.listActions();
  }
}

/**
 * Singleton engine instance backed by the shared registry.
 */
export const authorizationEngine = new AuthorizationEngine();

export default AuthorizationEngine;
