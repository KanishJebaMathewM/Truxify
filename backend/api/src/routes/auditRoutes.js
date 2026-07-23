import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { auditLog } from '../middleware/auditLog.js';
import { auditLogService } from '../services/auditLogService.js';
import { validateQuery } from '../middleware/validate.js';
import { z } from 'zod';

const router = express.Router();

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
    res.status(500).json({ error: 'Failed to fetch audit logs.', details: err.message });
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
    const { supabaseAdmin } = await import('../config/db.js');
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

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
