/**
 * Barrel exports for the centralized authorization system.
 *
 * Usage:
 *   import { ROLES, authorizationEngine, AuthorizationError } from '../core/auth/index.js';
 */

export { ROLES, isValidRole, allRoles } from './Role.js';
export { Permission } from './Permission.js';
export { BasePolicy } from './BasePolicy.js';
export { PolicyRegistry, registry } from './PolicyRegistry.js';
export { PolicyEvaluator } from './PolicyEvaluator.js';
export { AuthorizationError } from './AuthorizationError.js';
export { AuthorizationEngine, authorizationEngine } from './AuthorizationEngine.js';
export {
  logAuthGrant,
  logAuthDenial,
  logUnknownAction,
  logAuthFailure,
  createRequestAuthLogger,
} from './authorizationLogger.js';
