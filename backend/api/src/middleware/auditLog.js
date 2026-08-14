// ============================================================================
// FILE: src/middleware/auditLogMiddleware.js
// Description: Enterprise Audit Logging Middleware & State Interceptor
// ============================================================================

import { auditLogService } from '../services/auditLogService.js';
import logger from './logger.js';
import * as Sentry from '@sentry/node';

/**
 * Sensitive field keys to automatically redact from audit payloads.
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordconfirmation',
  'secret',
  'token',
  'authorization',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'privatekey',
  'ssn',
  'creditcard',
  'cardnumber',
  'cvv',
]);

/**
 * Maps HTTP methods and policy actions to semantic resource types.
 */
const ACTION_RESOURCE_MAP = Object.freeze({
  'admin:view-dashboard': { resourceType: 'admin_dashboard' },
  'admin:invalidate-cache': { resourceType: 'user_profile_cache' },
  'ticket:admin-view-all': { resourceType: 'support_ticket' },
  'ticket:view': { resourceType: 'support_ticket' },
  'ticket:update': { resourceType: 'support_ticket' },
  'ticket:add-comment': { resourceType: 'support_ticket_comment' },
  'fraud:view-stats': { resourceType: 'fraud_stats' },
  'fraud:view-risk': { resourceType: 'fraud_risk_profile' },
  'fraud:manage-review': { resourceType: 'fraud_review' },
  'fraud:analyze-network': { resourceType: 'fraud_network' },
  'order:create': { resourceType: 'order' },
  'order:cancel': { resourceType: 'order' },
  'order:accept-bid': { resourceType: 'order' },
  'order:change-drop': { resourceType: 'order' },
  'order:confirm-deposit': { resourceType: 'order' },
  'order:submit-rating': { resourceType: 'order_rating' },
  'bid:submit': { resourceType: 'load_bid' },
  'milestone:update': { resourceType: 'order_milestone' },
  'delivery:verify': { resourceType: 'delivery_verification' },
  'delivery:resend-otp': { resourceType: 'delivery_otp' },
  'driver:withdraw': { resourceType: 'wallet_withdrawal' },
  'driver:toggle-online': { resourceType: 'driver_status' },
  'profile:update': { resourceType: 'user_profile' },
  'profile:update-wallet': { resourceType: 'wallet_address' },
  'truck:register': { resourceType: 'truck' },
  'shard:view': { resourceType: 'shard_config' },
  'shard:query-orders': { resourceType: 'shard_query' },
  'webrtc:view-stats': { resourceType: 'webrtc_stats' },
});

/**
 * Recursively sanitizes sensitive parameters, arrays, and nested structures.
 */
export function sanitizePayload(data, maxDepth = 5, currentDepth = 0) {
  if (data === null || data === undefined) return data;
  if (currentDepth > maxDepth) return '[Max Depth Exceeded]';

  if (typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizePayload(item, maxDepth, currentDepth + 1));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(data)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, '');
    if (SENSITIVE_KEYS.has(normalizedKey)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizePayload(value, maxDepth, currentDepth + 1);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Computes structural differences between beforeState and afterState.
 */
export function computeStateDiff(before, after) {
  if (!before && !after) return null;
  if (!before) return { added: sanitizePayload(after) };
  if (!after) return { removed: sanitizePayload(before) };

  const cleanBefore = sanitizePayload(before);
  const cleanAfter = sanitizePayload(after);

  const changes = {};
  const allKeys = new Set([...Object.keys(cleanBefore), ...Object.keys(cleanAfter)]);

  for (const key of allKeys) {
    const prevVal = cleanBefore[key];
    const newVal = cleanAfter[key];

    if (JSON.stringify(prevVal) !== JSON.stringify(newVal)) {
      changes[key] = {
        from: prevVal !== undefined ? prevVal : null,
        to: newVal !== undefined ? newVal : null,
      };
    }
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

/**
 * Resolves the resource type from policy action or URI pattern.
 */
export function resolveResourceType(action, req) {
  const mapping = ACTION_RESOURCE_MAP[action];
  if (mapping) return mapping.resourceType;

  const pathParts = (req.originalUrl || req.path || '').split('?')[0].split('/').filter(Boolean);
  if (pathParts.length >= 2) {
    const primarySegment = pathParts[1].toLowerCase().replace(/s$/, '');
    return primarySegment || 'unknown';
  }
  return 'unknown';
}

/**
 * Resolves the target resource identifier from request params or body.
 */
export function resolveResourceId(req) {
  return (
    req.params?.id ||
    req.params?.orderId ||
    req.params?.userId ||
    req.params?.reviewId ||
    req.params?.ticketId ||
    req.body?.id ||
    req.query?.id ||
    null
  );
}

/**
 * Factory creating configurable audit logging middleware.
 *
 * @param {object} options
 * @param {string} options.action - Policy action identifier
 * @param {string} [options.resourceType] - Explicit override for resource type
 * @param {function} [options.getBeforeState] - Capture pre-mutation state: (req) => object
 * @param {function} [options.getAfterState] - Capture post-mutation state: (req, res) => object
 * @param {function} [options.getMetadata] - Attach operational metadata: (req, res) => object
 * @param {function} [options.shouldLog] - Filter function: (req, res) => boolean
 * @param {boolean} [options.logAnonymous=false] - Whether to capture unauthenticated actions
 */
export function auditLog(options = {}) {
  const {
    action,
    resourceType: overrideResourceType,
    getBeforeState,
    getAfterState,
    getMetadata,
    shouldLog,
    logAnonymous = false,
  } = options;

  return (req, res, next) => {
    // Skip if no authenticated user (unless anonymous logging explicitly enabled)
    if (!req.user && !logAnonymous) {
      return next();
    }

    // Evaluate execution filter
    if (shouldLog && !shouldLog(req, res)) {
      return next();
    }

    const startTime = Date.now();
    let beforeState = null;

    // Asynchronously capture before-state prior to downstream handlers
    const captureBeforeState = async () => {
      if (getBeforeState) {
        try {
          beforeState = await getBeforeState(req);
        } catch (err) {
          logger.debug({ err, action }, '[AuditLog] Failed to capture before-state');
        }
      }
    };

    // Attach response finish hook
    res.on('finish', () => {
      setImmediate(async () => {
        try {
          await writeAuditEntry(req, res, {
            action,
            overrideResourceType,
            beforeState,
            startTime,
            getAfterState,
            getMetadata,
          });
        } catch (err) {
          logger.error({ err, action }, '[AuditLog] Unhandled error during audit write');
          Sentry.captureException(err, { tags: { context: 'audit_log_write', action } });
        }
      });
    });

    // Execute state capture and continue middleware chain
    Promise.resolve(captureBeforeState())
      .then(() => next())
      .catch((err) => {
        logger.debug({ err, action }, '[AuditLog] Before-state resolution exception, continuing execution');
        next();
      });
  };
}

/**
 * Persists audit record to database and logs event.
 */
async function writeAuditEntry(req, res, {
  action,
  overrideResourceType,
  beforeState,
  startTime,
  getAfterState,
  getMetadata,
}) {
  const resourceType = overrideResourceType || resolveResourceType(action, req);
  const resourceId = resolveResourceId(req);

  let afterState = null;
  if (getAfterState) {
    try {
      afterState = await getAfterState(req, res);
    } catch (err) {
      logger.debug({ err, action }, '[AuditLog] Failed to capture after-state');
    }
  }

  let metadata = {};
  if (getMetadata) {
    try {
      const customMeta = await getMetadata(req, res);
      if (customMeta && typeof customMeta === 'object') {
        metadata = { ...customMeta };
      }
    } catch (err) {
      logger.debug({ err, action }, '[AuditLog] Failed to capture metadata');
    }
  }

  // Calculate execution timing and state diffs
  const durationMs = Date.now() - startTime;
  metadata.duration_ms = durationMs;

  const sanitizedBefore = sanitizePayload(beforeState);
  const sanitizedAfter = sanitizePayload(afterState);
  const stateDiff = computeStateDiff(sanitizedBefore, sanitizedAfter);

  if (stateDiff) {
    metadata.diff = stateDiff;
  }

  const actorId = req.user?.id || 'ANONYMOUS';
  const actorRole = req.user?.role || 'UNAUTHENTICATED';
  const actorName = req.user?.fullName || req.user?.username || 'System/Guest';

  const payload = {
    actorId,
    actorRole,
    actorName,
    action: action || `http:${req.method.toLowerCase()}:${req.route?.path || 'unknown'}`,
    resourceType,
    resourceId: resourceId ? String(resourceId) : null,
    method: req.method,
    path: req.originalUrl || req.path,
    ipAddress: req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
    userAgent: req.headers?.['user-agent'] || 'unknown',
    correlationId: req.correlationId || req.headers['x-correlation-id'] || null,
    requestId: req.requestId || req.headers['x-request-id'] || null,
    statusCode: res.statusCode,
    beforeState: sanitizedBefore,
    afterState: sanitizedAfter,
    metadata: sanitizePayload(metadata),
    status: res.statusCode < 400 ? 'SUCCESS' : 'FAILURE',
    timestamp: new Date().toISOString(),
  };

  await auditLogService.log(payload);
}

/**
 * Convenience helper for auditing general administrative actions.
 */
export function auditAdminAction(action) {
  return auditLog({ action });
}

/**
 * High-order helper for capturing state pre- and post-mutation from Supabase.
 */
export function auditWithState(action, resourceType, getIdFn) {
  const extractId = getIdFn || resolveResourceId;

  return auditLog({
    action,
    resourceType,
    getBeforeState: async (req) => {
      const { supabaseAdmin } = await import('../config/db.js');
      if (!supabaseAdmin) return null;
      const id = extractId(req);
      if (!id) return null;
      const { data } = await supabaseAdmin
        .from(resourceType)
        .select('*')
        .eq('id', id)
        .maybeSingle();
      return data || null;
    },
    getAfterState: async (req, res) => {
      if (res.statusCode >= 400) return null;
      const { supabaseAdmin } = await import('../config/db.js');
      if (!supabaseAdmin) return null;
      const id = extractId(req);
      if (!id) return null;
      const { data } = await supabaseAdmin
        .from(resourceType)
        .select('*')
        .eq('id', id)
        .maybeSingle();
      return data || null;
    },
  });
}
