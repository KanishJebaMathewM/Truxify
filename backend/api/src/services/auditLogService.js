import { supabaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';
import { appendFile } from 'fs/promises';
import path from 'path';
import { createClient } from 'redis';

const TABLE = 'application_audit_logs';

const DEAD_LETTER_PATH =
  process.env.AUDIT_DEAD_LETTER_FILE ||
  path.join(process.cwd(), 'audit-dead-letter.log');

// Redis configuration
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const STREAM_NAME = 'truxify:audit_events';

let redisClient;
try {
  redisClient = createClient({ url: redisUrl });
  
  redisClient.on('error', (err) => {
    logger.error({ err }, '[AuditLog] Redis Client Error');
  });
} catch (err) {
  logger.error({ err }, '[AuditLog] Failed to initialize Redis client');
}

/**
 * Connect to Redis if not already connected
 */
async function connectRedis() {
  if (redisClient && !redisClient.isOpen) {
    try {
      await redisClient.connect();
    } catch (err) {
      logger.error({ err }, '[AuditLog] Failed to connect to Redis');
    }
  }
}

/**
 * Persist a failed audit record to a durable, append-only dead-letter log so
 * entries are never silently lost during a DB outage. The file can be replayed
 * once the database is healthy.
 */
async function deadLetterAuditEntry(record, reason) {
  try {
    await appendFile(
      DEAD_LETTER_PATH,
      JSON.stringify({
        ...record,
        _deadLetterReason: reason,
        _deadLetteredAt: new Date().toISOString(),
      }) + '\n'
    );
  } catch (writeErr) {
    logger.error(
      { err: writeErr },
      '[AuditLog] Failed to write audit entry to dead-letter log'
    );
  }
}

/**
 * Log audit event to Redis stream for real-time processing
 * @param {object} eventData - Audit event data
 */
async function logToRedisStream(eventData) {
  try {
    await connectRedis();
    
    if (!redisClient || !redisClient.isOpen) {
      logger.warn('[AuditLog] Redis client not available — skipping stream write');
      return;
    }

    const payload = {
      timestamp: new Date().toISOString(),
      userId: eventData.userId || eventData.actorId || 'system',
      action: eventData.action,
      entityType: eventData.entityType || eventData.resourceType,
      entityId: eventData.entityId || eventData.resourceId,
      details: JSON.stringify(eventData.details || eventData.metadata || {}),
      idempotencyKey: eventData.idempotencyKey || `${Date.now()}-${Math.random()}`,
    };

    await redisClient.xAdd(STREAM_NAME, '*', payload);
  } catch (err) {
    logger.error(
      { err },
      '[AuditLog] Failed to write audit event to Redis stream'
    );
    // Fallback to console for debugging
    logger.info('[AuditLog] AUDIT FALLBACK:', JSON.stringify(eventData));
  }
}

/**
 * Centralized audit log service for recording privileged administrative operations.
 *
 * Uses the Supabase admin client (service role) to bypass RLS for writes.
 * All write failures are caught and logged but never propagate — audit logging
 * must never prevent the request from succeeding.
 * 
 * Also writes to Redis stream for real-time event processing.
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
    if (!entry.actorId) {
      logger.warn('[AuditLog] actorId is required — audit entry dropped.');
      return null;
    }
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

    let dbSuccess = false;
    let dbError;

    // Write to Supabase (persistent storage)
    try {
      const { data, error } = await supabaseAdmin
        .from(TABLE)
        .insert(record)
        .select()
        .single();

      if (error) {
        logger.error({ err: error }, '[AuditLog] Failed to insert audit entry to Supabase');
        dbError = error.message || 'insert_error';
        await deadLetterAuditEntry(record, dbError);
      } else {
        dbSuccess = true;
      }
    } catch (err) {
      logger.error({ err }, '[AuditLog] Exception inserting audit entry to Supabase');
      dbError = err.message || 'insert_exception';
      await deadLetterAuditEntry(record, dbError);
    }

    // Write to Redis stream (real-time processing) - non-blocking
    const redisEventData = {
      userId: entry.actorId,
      action: entry.action,
      entityType: entry.resourceType,
      entityId: entry.resourceId,
      details: {
        actorRole: entry.actorRole,
        actorName: entry.actorName,
        method: entry.method,
        path: entry.path,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        correlationId: entry.correlationId,
        requestId: entry.requestId,
        statusCode: entry.statusCode,
        beforeState: entry.beforeState,
        afterState: entry.afterState,
        metadata: entry.metadata,
      },
      idempotencyKey: entry.requestId || entry.correlationId,
    };

    // Fire-and-forget Redis write (don't block the response)
    logToRedisStream(redisEventData).catch((err) => {
      logger.error({ err }, '[AuditLog] Background Redis stream write failed');
    });

    return dbSuccess ? record : null;
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

  /**
   * Read events from Redis stream for processing
   * @param {string} consumerGroup - Consumer group name
   * @param {string} consumerName - Consumer name
   * @param {number} count - Number of messages to read
   * @returns {Promise<Array>} Array of stream messages
   */
  async readFromStream(consumerGroup = 'audit-processors', consumerName = 'worker-1', count = 10) {
    try {
      await connectRedis();
      
      if (!redisClient || !redisClient.isOpen) {
        logger.warn('[AuditLog] Redis client not available for stream reading');
        return [];
      }

      // Try to read from consumer group first
      try {
        const messages = await redisClient.xReadGroup(
          consumerGroup,
          consumerName,
          { key: STREAM_NAME, id: '>' },
          { COUNT: count }
        );
        
        if (messages && messages[0]) {
          return messages[0].messages.map(msg => ({
            id: msg.id,
            data: msg.message,
          }));
        }
      } catch (groupErr) {
        // If consumer group doesn't exist, create it and try again
        if (groupErr.message.includes('NOGROUP')) {
          try {
            await redisClient.xGroupCreate(STREAM_NAME, consumerGroup, '0', { MKSTREAM: true });
            logger.info('[AuditLog] Created consumer group:', consumerGroup);
          } catch (createErr) {
            logger.error({ err: createErr }, '[AuditLog] Failed to create consumer group');
          }
        }
      }

      // Fallback to simple read if group read fails
      const messages = await redisClient.xRange(STREAM_NAME, '-', '+', { COUNT: count });
      return messages.map(msg => ({
        id: msg.id,
        data: msg.message,
      }));
    } catch (err) {
      logger.error({ err }, '[AuditLog] Failed to read from Redis stream');
      return [];
    }
  }

  /**
   * Acknowledge processed messages in Redis stream
   * @param {string} consumerGroup - Consumer group name
   * @param {Array<string>} messageIds - Array of message IDs to acknowledge
   */
  async acknowledgeMessages(consumerGroup = 'audit-processors', messageIds = []) {
    try {
      await connectRedis();
      
      if (!redisClient || !redisClient.isOpen || messageIds.length === 0) {
        return;
      }

      await redisClient.xAck(STREAM_NAME, consumerGroup, messageIds);
    } catch (err) {
      logger.error({ err }, '[AuditLog] Failed to acknowledge Redis stream messages');
    }
  }

  /**
   * Get stream info (length, consumer groups, etc.)
   * @returns {Promise<object>} Stream information
   */
  async getStreamInfo() {
    try {
      await connectRedis();
      
      if (!redisClient || !redisClient.isOpen) {
        return { error: 'Redis client not available' };
      }

      const info = await redisClient.xInfoStream(STREAM_NAME);
      const groups = await redisClient.xInfoGroups(STREAM_NAME);
      
      return {
        streamName: STREAM_NAME,
        length: info.length,
        radixTreeKeys: info['radix-tree-keys'],
        radixTreeNodes: info['radix-tree-nodes'],
        groups: groups || [],
      };
    } catch (err) {
      logger.error({ err }, '[AuditLog] Failed to get stream info');
      return { error: err.message };
    }
  }
}

export const auditLogService = new AuditLogService();
export { redisClient, STREAM_NAME };
export default auditLogService;
