/**
 * PolicyEvaluator performs authorization decisions against the PolicyRegistry.
 *
 * It evaluates whether a user is allowed to perform a given action on an
 * optional resource, using the registered permission's role and ownership rules.
 */

import { PolicyRegistry } from './PolicyRegistry.js';
import { AuthorizationError } from './AuthorizationError.js';

export class PolicyEvaluator {
  /**
   * @param {PolicyRegistry} registry
   */
  constructor(registry) {
    this.registry = registry;
  }

  /**
   * Evaluate whether `user` can perform `action` on optional `resource`.
   *
   * @param {object}  user       - Authenticated user (must have .id and .role)
   * @param {string}  action     - Policy action name
   * @param {object}  [resource] - Optional resource for ownership checks
   * @returns {{ allowed: boolean, permission?: object, reason?: string }}
   * @throws {AuthorizationError} when user is unauthenticated or action is unknown
   */
  evaluate(user, action, resource) {
    if (!user || !user.role) {
      throw new AuthorizationError(401, 'Not authenticated: user context is missing.');
    }

    const permission = this.registry.get(action);
    if (!permission) {
      throw new AuthorizationError(403, `Unknown authorization action: ${action}`);
    }

    if (!permission.isRoleAllowed(user.role)) {
      return {
        allowed: false,
        permission: permission.toJSON(),
        reason: `Role '${user.role}' is not permitted for action '${action}'.`,
      };
    }

    if (resource !== undefined && !permission.checkOwnership(user, resource)) {
      return {
        allowed: false,
        permission: permission.toJSON(),
        reason: `Access denied: resource ownership check failed for action '${action}'.`,
      };
    }

    return {
      allowed: true,
      permission: permission.toJSON(),
    };
  }

  /**
   * Like evaluate(), but throws AuthorizationError on denial.
   * Suitable for middleware use where you want early termination.
   */
  authorize(user, action, resource) {
    const result = this.evaluate(user, action, resource);
    if (!result.allowed) {
      throw new AuthorizationError(403, result.reason);
    }
    return result;
  }
}

export default PolicyEvaluator;
