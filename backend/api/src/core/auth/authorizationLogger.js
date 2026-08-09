/**
 * Structured authorization logging for the Truxify authorization engine.
 *
 * Provides consistent, audit-friendly log entries for:
 * - Successful authorization decisions
 * - Permission denials (role mismatch, ownership failure)
 * - Unknown action attempts
 * - Authentication failures
 *
 * Logs are structured as JSON and follow the project's correlation-ID
 * pattern for request tracing. Resource type metadata is included in
 * development mode for debugging.
 */

import logger from '../../middleware/logger.js';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Log a successful authorization decision.
 */
export function logAuthGrant({ user, action, resource, requestId, durationMs }) {
  const entry = {
    event: 'AUTH_GRANT',
    action,
    userId: user?.id,
    userRole: user?.role,
    requestId,
    durationMs,
  };
  if (isDev && resource) {
    entry.resourceType = typeof resource === 'object' ? 'object' : String(resource);
  }
  logger.info(entry);
}

/**
 * Log a denied authorization decision.
 */
export function logAuthDenial({ user, action, resource, reason, requestId, durationMs }) {
  const entry = {
    event: 'AUTH_DENIAL',
    action,
    userId: user?.id,
    userRole: user?.role,
    reason,
    requestId,
    durationMs,
  };
  if (isDev && resource) {
    entry.resourceType = typeof resource === 'object' ? 'object' : String(resource);
  }
  logger.warn(entry);
}

/**
 * Log an attempt to use an unknown/undefined policy action.
 */
export function logUnknownAction({ user, action, requestId }) {
  logger.warn({
    event: 'AUTH_UNKNOWN_ACTION',
    action,
    userId: user?.id,
    requestId,
  });
}

/**
 * Log an authentication failure (no token, invalid token, etc.)
 */
export function logAuthFailure({ reason, ip, requestId }) {
  logger.warn({
    event: 'AUTH_FAILURE',
    reason,
    ip,
    requestId,
  });
}

/**
 * Create a child logger scoped to a specific request for authorization context.
 * @param {string} requestId
 * @returns {object} Logger-like object with grant/denial/unknown methods
 */
export function createRequestAuthLogger(requestId) {
  return {
    grant: (opts) => logAuthGrant({ ...opts, requestId }),
    denial: (opts) => logAuthDenial({ ...opts, requestId }),
    unknownAction: (opts) => logUnknownAction({ ...opts, requestId }),
    failure: (opts) => logAuthFailure({ ...opts, requestId }),
  };
}

export default {
  logAuthGrant,
  logAuthDenial,
  logUnknownAction,
  logAuthFailure,
  createRequestAuthLogger,
};
