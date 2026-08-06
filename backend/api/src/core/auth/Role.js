/**
 * Centralized role definitions for the Truxify authorization system.
 *
 * All role strings used across the application are defined here to prevent
 * typos and ensure consistency. Every policy, middleware, and route handler
 * should reference these constants instead of hardcoded strings.
 */

export const ROLES = Object.freeze({
  CUSTOMER: 'customer',
  DRIVER: 'driver',
  ADMIN: 'admin',
});

const ROLE_SET = new Set(Object.values(ROLES));

/**
 * Checks whether a given string is a recognized application role.
 * @param {string} role
 * @returns {boolean}
 */
export function isValidRole(role) {
  return typeof role === 'string' && ROLE_SET.has(role);
}

/**
 * Returns all valid roles as an array.
 * @returns {string[]}
 */
export function allRoles() {
  return Object.values(ROLES);
}

export default ROLES;
