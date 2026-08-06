/**
 * Permission model for the Truxify authorization system.
 *
 * A Permission encapsulates a single atomic authorization check: a named action,
 * optional role allow-list, and an optional ownership/resource check function.
 *
 * Permissions are immutable once created and are registered in the PolicyRegistry.
 */

export class Permission {
  /**
   * @param {object} opts
   * @param {string}   opts.action      - Unique action identifier (e.g. "order:create")
   * @param {string[]} [opts.roles]      - Allowed roles; empty/undefined = any authenticated role
   * @param {function} [opts.ownership]  - (user, resource) => boolean — resource access check
   * @param {string}   [opts.description]- Human-readable description for docs/debugging
   */
  constructor({ action, roles, ownership, description }) {
    if (!action || typeof action !== 'string') {
      throw new Error('Permission requires a non-empty action string.');
    }
    this.action = action;
    this.roles = roles ? Object.freeze([...roles]) : [];
    this.ownership = typeof ownership === 'function' ? ownership : null;
    this.description = description || '';
  }

  /**
   * Check if the given role is permitted by this permission.
   * Empty roles list means any authenticated role is allowed.
   * @param {string} role
   * @returns {boolean}
   */
  isRoleAllowed(role) {
    if (!role) return false;
    if (this.roles.length === 0) return true;
    return this.roles.includes(role);
  }

  /**
   * Evaluate resource ownership check if one exists.
   * Returns true if no ownership check is defined (open access).
   * @param {object} user
   * @param {object} [resource]
   * @returns {boolean}
   */
  checkOwnership(user, resource) {
    if (!this.ownership) return true;
    return this.ownership(user, resource);
  }

  toJSON() {
    return {
      action: this.action,
      roles: this.roles,
      hasOwnershipCheck: !!this.ownership,
      description: this.description,
    };
  }
}

export default Permission;
