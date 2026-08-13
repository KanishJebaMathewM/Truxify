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

    // Hook into response finish event to capture the final state and write the audit entry
    res.on('finish', () => {
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

    });

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
 * Keys whose values must never reach the audit log. Matching is
 * case-insensitive on the final path segment so nested payloads are covered
 * too (e.g. `body.password`, `headers.authorization`).
 */
const SENSITIVE_KEY_PATTERN = /(password|passwd|secret|token|otp|authorization|api[_-]?key|access[_-]?key|cookie|cvv|pin)\b/i;

/**
 * Recursively redacts sensitive fields before an audit entry is persisted.
 *
 * beforeState / afterState / metadata are developer-supplied snapshots that
 * can echo request bodies verbatim. Scrub here — not at the call sites — so a
 * future getAfterState callback cannot accidentally leak credentials into the
 * audit trail.
 *
 * @param {unknown} value
 * @param {string} [path] - current object path, used for key matching
 * @returns {unknown} the value with sensitive fields replaced by "[REDACTED]"
 */
export function scrubPii(value, path = '') {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map((item, index) => scrubPii(item, `${path}[${index}]`));
  }

  if (typeof value === 'object') {
    const scrubbed = {};
    for (const [key, item] of Object.entries(value)) {
      const keyPath = path ? `${path}.${key}` : key;
      const isSensitive = SENSITIVE_KEY_PATTERN.test(key);
      scrubbed[key] = isSensitive ? '[REDACTED]' : scrubPii(item, keyPath);
    }
    return scrubbed;
  }

  if (typeof value === 'string') {
    // Redact 16-digit card numbers that may be embedded in strings.
    const CARD_NUMBER_PATTERN = /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/g;
    let scrubbed = value.replace(CARD_NUMBER_PATTERN, '[REDACTED]');
    // Redact full 10-digit Indian mobile numbers (starting 6-9) that may be
    // embedded in log/metadata strings. Partial numbers (e.g. last 4 digits
    // shown in UIs) are left alone.
    const PHONE_PATTERN = /\b[6-9]\d{9}\b/g;
    scrubbed = scrubbed.replace(PHONE_PATTERN, '[REDACTED]');
    return scrubbed;
  }

  return value;
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
    beforeState: scrubPii(beforeState),
    afterState: scrubPii(afterState),
    metadata: scrubPii(metadata),
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


// === Spec 20: ===
// === Spec 20: PII masking ===
const PII = new Set(['password', 'token', 'vpa', 'ssn', 'secret', 'pin']);
export function maskPii(value, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => maskPii(v, seen));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = PII.has(k.toLowerCase()) ? '***' : maskPii(v, seen);
  }
  return out;
}

