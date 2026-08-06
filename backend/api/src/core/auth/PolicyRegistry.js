/**
 * Central registry for all application permissions.
 *
 * The PolicyRegistry is the single source of truth for authorization policy
 * definitions. It supports:
 * - Registering permissions individually or via BasePolicy modules
 * - Looking up permissions by action
 * - Listing all registered actions (useful for introspection/debugging)
 * - Validating that all required policies are registered
 */

import { Permission } from './Permission.js';

export class PolicyRegistry {
  constructor() {
    /** @type {Map<string, Permission>} */
    this._permissions = new Map();
  }

  /**
   * Register a single permission.
   * @param {Permission|object} permissionOrOpts
   * @returns {Permission}
   */
  register(permissionOrOpts) {
    const perm = permissionOrOpts instanceof Permission
      ? permissionOrOpts
      : new Permission(permissionOrOpts);

    if (this._permissions.has(perm.action)) {
      throw new Error(`Permission already registered for action: ${perm.action}`);
    }
    this._permissions.set(perm.action, perm);
    return perm;
  }

  /**
   * Register multiple permissions at once.
   * @param {Array<Permission|object>} permissions
   */
  registerAll(permissions) {
    for (const perm of permissions) {
      this.register(perm);
    }
  }

  /**
   * Register all permissions from a BasePolicy module.
   * @param {import('./BasePolicy.js').BasePolicy} policyModule
   */
  registerPolicy(policyModule) {
    this.registerAll(policyModule.getPermissions());
  }

  /**
   * Look up a permission by action name.
   * @param {string} action
   * @returns {Permission|undefined}
   */
  get(action) {
    return this._permissions.get(action);
  }

  /**
   * Check if a permission is registered for the given action.
   * @param {string} action
   * @returns {boolean}
   */
  has(action) {
    return this._permissions.has(action);
  }

  /**
   * Returns all registered action names.
   * @returns {string[]}
   */
  listActions() {
    return [...this._permissions.keys()].sort();
  }

  /**
   * Returns all registered permissions as an array.
   * @returns {Permission[]}
   */
  listPermissions() {
    return [...this._permissions.values()];
  }

  /**
   * Returns the count of registered permissions.
   * @returns {number}
   */
  get size() {
    return this._permissions.size;
  }

  /**
   * Creates a snapshot of the registry for debugging.
   * @returns {object}
   */
  snapshot() {
    const policies = {};
    for (const [action, perm] of this._permissions) {
      policies[action] = perm.toJSON();
    }
    return {
      totalPermissions: this._permissions.size,
      policies,
    };
  }
}

export const registry = new PolicyRegistry();
export default PolicyRegistry;
