import { supabaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';

const TABLE = 'application_audit_logs';

/**
 * Centralized audit log service for recording privileged administrative operations.
 *
 * Uses the Supabase admin client (service role) to bypass RLS for writes.
 * All write failures are caught and logged but never propagate — audit logging
 * must never prevent the request from succeeding.
 */
class AuditLogService {
  /**
   * Create an audit log entry.
   *
   * @param {object} entry
   * @param {string} entry.actorId        - UUID of the user who performed the action
   * @param {string} entry.actorRole      - Role of the actor (admin, driver, customer)
   * @param {string} [entry.actorName]    - Display name of the actor
   * @param {string} entry.action         - Semantic action (e.g., 'admin:view-dashboard')
   * @param {string} entry.resourceType   - Resource type (e.g., 'order', 'profile', 'support_ticket')
   * @param {string} [entry.resourceId]   - Specific resource identifier
   * @param {string} entry.method         - HTTP method (GET, POST, PUT, PATCH, DELETE)
   * @param {string} entry.path           - Request path
   * @param {string} [entry.ipAddress]    - Client IP address
   * @param {string} [entry.userAgent]    - Client User-Agent header
   * @param {string} [entry.correlationId]- Correlation ID for request tracing
   * @param {string} [entry.requestId]    - Request ID for request tracing
   * @param {number} [entry.statusCode]   - HTTP response status code
   * @param {object} [entry.beforeState]  - Resource state before the action
   * @param {object} [entry.afterState]   - Resource state after the action
   * @param {object} [entry.metadata]     - Additional contextual information
   * @returns {Promise<object|null>}      - The created audit log entry, or null on failure
   */
  async log(entry) {
    if (!supabaseAdmin) {
      logger.warn('[AuditLog] Supabase admin client not available — audit entry dropped.');
      return null;
    }

    const record = {
      actor_id: entry.actorId,
      actor_role: entry.actorRole,
      actor_name: entry.actorName || null,
      action: entry.action,
      resource_type: entry.resourceType,
      resource_id: entry.resourceId || null,
      method: entry.method,
      path: entry.path,
      ip_address: entry.ipAddress || null,
      user_agent: entry.userAgent || null,
      correlation_id: entry.correlationId || null,
      request_id: entry.requestId || null,
      status_code: entry.statusCode || null,
      before_state: entry.beforeState || null,
      after_state: entry.afterState || null,
      metadata: entry.metadata || null,
      created_at: new Date().toISOString(),
    };

    try {
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .insert(record)
        .select()
        .single();

      if (error) {
        logger.error({ err: error }, '[AuditLog] Failed to insert audit entry');
        return null;
      }

      return data;
    } catch (err) {
      logger.error({ err }, '[AuditLog] Exception inserting audit entry');
      return null;
    }
  }

  /**
   * Query audit logs with filtering, pagination, and sorting.
   *
   * @param {object} filters
   * @param {string} [filters.actorId]      - Filter by actor UUID
   * @param {string} [filters.action]       - Filter by action (exact match)
   * @param {string} [filters.resourceType] - Filter by resource type (exact match)
   * @param {string} [filters.resourceId]   - Filter by resource ID (exact match)
   * @param {string} [filters.startDate]    - ISO date string - filter created_at >=
   * @param {string} [filters.endDate]      - ISO date string - filter created_at <=
   * @param {number} [filters.page=1]       - Page number (1-indexed)
   * @param {number} [filters.limit=20]     - Items per page (max 100)
   * @param {string} [filters.sortBy='created_at'] - Sort column
   * @param {string} [filters.sortOrder='desc']    - Sort direction ('asc' or 'desc')
   * @returns {Promise<object>}             - { data: [...], pagination: { page, limit, total, totalPages } }
   */
  async query(filters = {}) {
    if (!supabaseAdmin) {
      logger.warn('[AuditLog] Supabase admin client not available — query returns empty.');
      return { data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
    }

    const {
      actorId,
      action,
      resourceType,
      resourceId,
      startDate,
      endDate,
      page = 1,
      limit = 20,
      sortBy = 'created_at',
      sortOrder = 'desc',
    } = filters;

    const safePage = Math.max(1, Math.floor(Number(page) || 1));
    const rawLimit = Number(limit);
    const safeLimit = Math.min(Math.max(1, Math.floor(Number.isFinite(rawLimit) ? rawLimit : 20)), 100);
    const offset = (safePage - 1) * safeLimit;
    const validSortColumns = ['created_at', 'action', 'resource_type', 'actor_id', 'method'];
    const safeSortBy = validSortColumns.includes(sortBy) ? sortBy : 'created_at';
    const safeSortOrder = sortOrder === 'asc';

    let query = supabaseAdmin
      .from(TABLE)
      .select('*', { count: 'exact' });

    if (actorId) {
      query = query.eq('actor_id', actorId);
    }
    if (action) {
      query = query.eq('action', action);
    }
    if (resourceType) {
      query = query.eq('resource_type', resourceType);
    }
    if (resourceId) {
      query = query.eq('resource_id', resourceId);
    }
    if (startDate) {
      query = query.gte('created_at', startDate);
    }
    if (endDate) {
      query = query.lte('created_at', endDate);
    }

    const { data, error, count } = await query
      .order(safeSortBy, { ascending: safeSortOrder })
      .range(offset, offset + safeLimit - 1);

    if (error) {
      logger.error({ err: error }, '[AuditLog] Failed to query audit logs');
      return { data: [], pagination: { page: safePage, limit: safeLimit, total: 0, totalPages: 0 } };
    }

    const total = count || 0;

    return {
      data: data || [],
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }
}

export const auditLogService = new AuditLogService();
export default auditLogService;
