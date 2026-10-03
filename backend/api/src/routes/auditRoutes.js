import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { supabaseAdmin } from '../config/db.js';
import { auditLogService } from '../services/auditLogService.js';
import { validateQuery } from '../middleware/validate.js';
import logger from '../middleware/logger.js';
import { z } from 'zod';

const router = express.Router();
router.use(userLimiter);

const auditQuerySchema = z.object({
  actor_id: z.string().uuid().optional(),
  action: z.string().max(100).optional(),
  resource_type: z.string().max(100).optional(),
  resource_id: z.string().max(200).optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
  sort_by: z.enum(['created_at', 'action', 'resource_type', 'actor_id', 'method']).default('created_at').optional(),
  sort_order: z.enum(['asc', 'desc']).default('desc').optional(),
});

/**
 * @openapi
 * components:
 *   schemas:
 *     AuditLogEntry:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         actor_id:
 *           type: string
 *           format: uuid
 *         actor_role:
 *           type: string
 *         actor_name:
 *           type: string
 *           nullable: true
 *         action:
 *           type: string
 *         resource_type:
 *           type: string
 *         resource_id:
 *           type: string
 *           nullable: true
 *         method:
 *           type: string
 *         path:
 *           type: string
 *         ip_address:
 *           type: string
 *           nullable: true
 *         user_agent:
 *           type: string
 *           nullable: true
 *         correlation_id:
 *           type: string
 *           nullable: true
 *         request_id:
 *           type: string
 *           nullable: true
 *         status_code:
 *           type: integer
 *           nullable: true
 *         before_state:
 *           type: object
 *           nullable: true
 *         after_state:
 *           type: object
 *           nullable: true
 *         metadata:
 *           type: object
 *           nullable: true
 *         created_at:
 *           type: string
 *           format: date-time
 *     AuditLogListResponse:
 *       type: object
 *       properties:
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/AuditLogEntry'
 *         pagination:
 *           type: object
 *           properties:
 *             page:
 *               type: integer
 *             limit:
 *               type: integer
 *             total:
 *               type: integer
 *             totalPages:
 *               type: integer
 */

/**
 * @openapi
 * /api/v1/admin/audit-logs:
 *   get:
 *     tags: [Admin]
 *     summary: Query audit logs
 *     description: Retrieves paginated audit log entries with optional filtering by actor, action, resource type, resource ID, and date range. Admin role required.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: actor_id
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by actor UUID
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *         description: Filter by action (exact match)
 *       - in: query
 *         name: resource_type
 *         schema:
 *           type: string
 *         description: Filter by resource type (exact match)
 *       - in: query
 *         name: resource_id
 *         schema:
 *           type: string
 *         description: Filter by resource ID (exact match)
 *       - in: query
 *         name: start_date
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter logs created at or after this ISO datetime
 *       - in: query
 *         name: end_date
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter logs created at or before this ISO datetime
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number (1-indexed)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *         description: Items per page (max 100)
 *       - in: query
 *         name: sort_by
 *         schema:
 *           type: string
 *           enum: [created_at, action, resource_type, actor_id, method]
 *           default: created_at
 *         description: Sort column
 *       - in: query
 *         name: sort_order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort direction
 *     responses:
 *       200:
 *         description: Paginated audit log entries
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuditLogListResponse'
 *       400:
 *         description: Invalid query parameters
 *       403:
 *         description: Admin role required
 */
router.get('/', authenticate, userLimiter, requirePolicy('admin:view-audit-logs'), validateQuery(auditQuerySchema), async (req, res) => {
  try {
    const result = await auditLogService.query({
      actorId: req.query.actor_id,
      action: req.query.action,
      resourceType: req.query.resource_type,
      resourceId: req.query.resource_id,
      startDate: req.query.start_date,
      endDate: req.query.end_date,
      page: req.query.page,
      limit: req.query.limit,
      sortBy: req.query.sort_by,
      sortOrder: req.query.sort_order,
    });

    res.json(result);
  } catch (err) {
    logger.error({ requestId: req.requestId }, "[AuditRoutes] Error:", err?.message || err);
    res.status(500).json({ error: "Failed to fetch audit logs.", details: err?.message || String(err || 'Unknown error') });
  }
});

/**
 * @openapi
 * /api/v1/admin/audit-logs/{id}:
 *   get:
 *     tags: [Admin]
 *     summary: Get a single audit log entry
 *     description: Retrieves a specific audit log entry by its UUID. Admin role required.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Audit log entry UUID
 *     responses:
 *       200:
 *         description: Audit log entry
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuditLogEntry'
 *       404:
 *         description: Audit log entry not found
 *       403:
 *         description: Admin role required
 */
router.get('/:id', authenticate, userLimiter, requirePolicy('admin:view-audit-logs'), async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Admin database client not available.' });
    }

    const { data, error } = await supabaseAdmin
      .from('application_audit_logs')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch audit log entry.', details: error.message });
    }
    if (!data) {
      return res.status(404).json({ error: 'Audit log entry not found.' });
    }

    return res.json(data);
  } catch (err) {
    logger.error({ requestId: req.requestId, err: err?.message || err }, '[AuditRoutes] Error fetching audit log entry');
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * @fileoverview Admin endpoints for querying and exporting audit logs.
 */

import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { queryAuditLogs, exportAuditLogsJSON } from '../services/auditService.js';
import { verifyLogBatch } from '../lib/logSigner.js';
import logger from '../middleware/logger.js';

const SIGNING_SECRET = process.env.AUDIT_SIGNING_SECRET || 'truxify-audit-signing-secret';

/**
 * GET /api/audit/logs
 * Queries audit logs with filtering and pagination.
 */
router.get('/logs', authenticate, requireRole(['admin', 'compliance']), async (req, res) => {
  try {
    const {
      userId,
      eventType,
      severity,
      startDate,
      endDate,
      requestId,
      limit = 100,
      offset = 0
    } = req.query;

    const result = await queryAuditLogs({
      userId,
      eventType,
      severity,
      startDate,
      endDate,
      requestId,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10)
    });

    res.json({
      success: true,
      logs: result.logs,
      total: result.total,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10)
    });
  } catch (err) {
    logger.error({ err }, 'GET /audit/logs error');
    res.status(500).json({ error: 'Failed to query audit logs' });
  }
});

/**
 * GET /api/audit/export
 * Exports audit logs to JSON file download.
 */
router.get('/export', authenticate, requireRole(['admin', 'compliance']), async (req, res) => {
  try {
    const { startDate, endDate, eventType, userId } = req.query;

    const jsonString = await exportAuditLogsJSON({
      startDate,
      endDate,
      eventType,
      userId
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=audit_logs_${Date.now()}.json`);
    res.send(jsonString);
  } catch (err) {
    logger.error({ err }, 'GET /audit/export error');
    res.status(500).json({ error: 'Failed to export audit logs' });
  }
});

/**
 * POST /api/audit/verify
 * Verifies the HMAC signature of a batch of logs.
 */
router.post('/verify', authenticate, requireRole(['admin', 'compliance']), async (req, res) => {
  try {
    const { logs, signature } = req.body;

    if (!logs || !signature) {
      return res.status(400).json({ error: 'logs and signature are required' });
    }

    const isValid = verifyLogBatch(logs, signature, SIGNING_SECRET);

    res.json({
      success: true,
      isValid,
      message: isValid ? 'Batch signature is valid' : 'Batch signature is INVALID - logs may be tampered'
    });
  } catch (err) {
    logger.error({ err }, 'POST /audit/verify error');
    res.status(500).json({ error: 'Failed to verify batch' });
  }
});

/**
 * GET /api/audit/stats
 * Returns aggregate statistics about audit events.
 */
router.get('/stats', authenticate, requireRole(['admin', 'compliance']), async (req, res) => {
  try {
    // Simple stats query - in production, use materialized views
    const { data, error } = await supabaseAdmin
      .from('audit_logs')
      .select('event_type, severity');

    if (error) throw error;

    const stats = {
      total: data.length,
      byEventType: {},
      bySeverity: {}
    };

    for (const log of data) {
      stats.byEventType[log.event_type] = (stats.byEventType[log.event_type] || 0) + 1;
      stats.bySeverity[log.severity] = (stats.bySeverity[log.severity] || 0) + 1;
    }

    res.json({ success: true, stats });
  } catch (err) {
    logger.error({ err }, 'GET /audit/stats error');
    res.status(500).json({ error: 'Failed to fetch audit stats' });
  }
});

export default router;
