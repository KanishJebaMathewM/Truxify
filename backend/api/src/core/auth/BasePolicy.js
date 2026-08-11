/**
 * Base class for defining reusable policy modules.
 *
 * Extend BasePolicy to create domain-specific policy groups (e.g. OrderPolicy,
 * DriverPolicy) that can register their permissions with the PolicyRegistry.
 */

import { Permission } from './Permission.js';

export class BasePolicy {
  /**
   * @param {string} namespace - Policy namespace (e.g. "order", "driver")
   */
  constructor(namespace) {
    if (!namespace || typeof namespace !== 'string') {
      throw new Error('BasePolicy requires a non-empty namespace string.');
    }
    this.namespace = namespace;
    this._permissions = [];
  }

  /**
   * Register a permission under this policy namespace.
   * @param {object} opts - Permission options (see Permission constructor)
   * @returns {Permission}
   */
  define(opts) {
    const permission = new Permission(opts);
    this._permissions.push(permission);
    return permission;
  }

  /**
   * Returns all permissions defined in this policy.
   * @returns {Permission[]}
   */
  getPermissions() {
    return [...this._permissions];
  }

  /**
   * Returns a map of action -> Permission for this policy.
   * @returns {Map<string, Permission>}
   */
  toMap() {
    const map = new Map();
    for (const perm of this._permissions) {
      map.set(perm.action, perm);
    }
    return map;
  }
}

export default BasePolicy;
