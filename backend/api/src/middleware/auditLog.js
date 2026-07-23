import { auditLogService } from '../services/auditLogService.js';
import logger from './logger.js';

/**
 * Maps HTTP methods and policy actions to semantic resource types.
 * This mapping provides human-readable resource types in audit logs.
 */
const ACTION_RESOURCE_MAP = {
  'admin:view-dashboard':              { resourceType: 'admin_dashboard' },
  'admin:invalidate-cache':            { resourceType: 'user_profile_cache' },
  'ticket:admin-view-all':             { resourceType: 'support_ticket' },
  'ticket:view':                       { resourceType: 'support_ticket' },
  'ticket:update':                     { resourceType: 'support_ticket' },
  'ticket:add-comment':                { resourceType: 'support_ticket_comment' },
  'fraud:view-stats':                  { resourceType: 'fraud_stats' },
  'fraud:view-risk':                   { resourceType: 'fraud_risk_profile' },
  'fraud:manage-review':               { resourceType: 'fraud_review' },
  'fraud:analyze-network':             { resourceType: 'fraud_network' },
  'order:create':                      { resourceType: 'order' },
  'order:cancel':                      { resourceType: 'order' },
  'order:accept-bid':                  { resourceType: 'order' },
  'order:change-drop':                 { resourceType: 'order' },
  'order:confirm-deposit':             { resourceType: 'order' },
  'order:submit-rating':               { resourceType: 'order_rating' },
  'bid:submit':                        { resourceType: 'load_bid' },
  'milestone:update':                  { resourceType: 'order_milestone' },
  'delivery:verify':                   { resourceType: 'delivery_verification' },
  'delivery:resend-otp':               { resourceType: 'delivery_otp' },
  'driver:withdraw':                   { resourceType: 'wallet_withdrawal' },
  'driver:toggle-online':              { resourceType: 'driver_status' },
  'profile:update':                    { resourceType: 'user_profile' },
  'profile:update-wallet':             { resourceType: 'wallet_address' },
  'truck:register':                    { resourceType: 'truck' },
  'shard:view':                        { resourceType: 'shard_config' },
  'shard:query-orders':                { resourceType: 'shard_query' },
  'webrtc:view-stats':                 { resourceType: 'webrtc_stats' },
};

/**
 * Resolves the resource type from the policy action and request context.
 */
function resolveResourceType(action, req) {
  const mapping = ACTION_RESOURCE_MAP[action];
  if (mapping) return mapping.resourceType;

  // Fallback: derive from HTTP method and path
  const pathParts = (req.originalUrl || req.path).split('/').filter(Boolean);
  if (pathParts.length >= 2) {
    return pathParts[1] || 'unknown';
  }
  return 'unknown';
}

/**
 * Extracts the resource ID from the request parameters or body.
 */
function resolveResourceId(req) {
  return req.params?.id
    || req.params?.orderId
    || req.params?.userId
    || req.params?.reviewId
    || req.params?.ticketId
    || req.body?.id
    || null;
}

/**
 * Creates reusable audit logging middleware.
 *
 * This middleware intercepts the response to capture the status code after
 * the route handler completes, then writes an audit entry asynchronously.
 * Audit failures are silently caught and logged — they never prevent
 * the request from succeeding.
 *
 * @param {object} options
 * @param {string} options.action       - The policy action identifier (e.g., 'admin:view-dashboard')
 * @param {string} [options.resourceType] - Override resource type (auto-detected from action if omitted)
 * @param {function} [options.getBeforeState] - Async function to capture before-state: (req) => object
 * @param {function} [options.getAfterState]  - Async function to capture after-state: (req, res) => object
 * @param {function} [options.getMetadata]    - Async function to capture metadata: (req, res) => object
 * @param {function} [options.shouldLog]      - Filter function: (req, res) => boolean. Default: log all.
 */
export function auditLog(options = {}) {
  const {
    action,
    resourceType: overrideResourceType,
    getBeforeState,
    getAfterState,
    getMetadata,
    shouldLog,
  } = options;

  return (req, res, next) => {
    // Skip if no authenticated user
    if (!req.user) {
      return next();
    }

    // Skip if shouldLog filter rejects this request
    if (shouldLog && !shouldLog(req, null)) {
      return next();
    }

    const startTime = Date.now();
    let beforeState = null;

    // Capture before-state before the response is sent
    const captureBeforeState = async () => {
      if (getBeforeState) {
        try {
          beforeState = await getBeforeState(req);
        } catch (err) {
          logger.debug({ err }, '[AuditLog] Failed to capture before-state');
        }
      }
    };

    // Hook into response finish to capture the final state and write the audit entry
    const originalFinish = res.finish;
    res.finish = function (...args) {
      // Restore original finish to avoid double-hooking
      res.finish = originalFinish;

      // Run the original finish
      const result = originalFinish.apply(this, args);

      // Write audit entry asynchronously (fire-and-forget)
      writeAuditEntry(req, res, {
        action,
        overrideResourceType,
        beforeState,
        startTime,
        getAfterState,
        getMetadata,
      }).catch((err) => {
        logger.debug({ err }, '[AuditLog] Unhandled audit write error');
      });

      return result;
    };

    // Capture before-state synchronously, then proceed
    Promise.resolve(captureBeforeState())
      .then(() => next())
      .catch((err) => {
        logger.debug({ err }, '[AuditLog] Before-state capture failed, proceeding');
        next();
      });
  };
}

/**
 * Writes the audit entry to the database.
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
      logger.debug({ err }, '[AuditLog] Failed to capture after-state');
    }
  }

  let metadata = null;
  if (getMetadata) {
    try {
      metadata = await getMetadata(req, res);
    } catch (err) {
      logger.debug({ err }, '[AuditLog] Failed to capture metadata');
    }
  }

  // Add timing info to metadata
  const durationMs = Date.now() - startTime;
  if (!metadata) {
    metadata = {};
  }
  metadata.duration_ms = durationMs;

  await auditLogService.log({
    actorId: req.user.id,
    actorRole: req.user.role,
    actorName: req.user.fullName,
    action,
    resourceType,
    resourceId,
    method: req.method,
    path: req.originalUrl || req.path,
    ipAddress: req.ip || req.connection?.remoteAddress,
    userAgent: req.headers?.['user-agent'],
    correlationId: req.correlationId,
    requestId: req.requestId,
    statusCode: res.statusCode,
    beforeState,
    afterState,
    metadata,
  });
}

/**
 * Convenience: creates audit middleware for common admin operations.
 * Just pass the action name — the middleware handles the rest.
 *
 * @param {string} action - The policy action identifier
 * @returns {Function} Express middleware
 */
export function auditAdminAction(action) {
  return auditLog({ action });
}

/**
 * Convenience: creates audit middleware that captures before/after state
 * by fetching the resource from Supabase.
 *
 * @param {string} action         - The policy action identifier
 * @param {string} resourceType   - The Supabase table name
 * @param {function} [getIdFn]    - Function to extract resource ID from req: (req) => string
 * @returns {Function} Express middleware
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
      // Only capture after-state for successful mutations (2xx responses)
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
