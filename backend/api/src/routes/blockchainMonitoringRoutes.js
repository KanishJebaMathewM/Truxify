import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import logger from '../middleware/logger.js';
import { supabase } from '../config/db.js';
import {
  BlockchainMetrics,
  EscalationHandler,
  defaultBlockchainMetrics,
  defaultEscalationHandler,
} from '../services/blockchain/index.js';

const router = express.Router();

// Canonical shared singleton fallback instances — ensure in-memory state
// (escalation timers, alert maps) remains uniform across requests and tests.
const blockchainMetrics = defaultBlockchainMetrics;
const escalationHandler = defaultEscalationHandler;

const resolveSupabaseClient = (req) => req.supabase ?? supabase;

// The index.js mount attaches shared singletons and req.supabase =
// supabaseAdmin (service-role key, bypasses RLS) so monitoring queries are
// never limited to the anon client's rows. Only fall back to the router-local
// instances when nothing else attached them (e.g. standalone/test mounts),
// so a middleware-attached service is never silently overwritten.
router.use((req, _res, next) => {
  req.blockchainMetrics = req.blockchainMetrics || blockchainMetrics;
  req.escalationHandler = req.escalationHandler || escalationHandler;
  req.blockchainMetrics ??= blockchainMetrics;
  req.escalationHandler ??= escalationHandler;
  next();
});

/**
 * Get monitor health and block lag
 * GET /api/blockchain/health
 */
router.get('/health', async (req, res) => {
  try {
    const monitor = req.blockchainMonitor;
    if (!monitor) {
      return res.json({
        status: 'stopped',
        running: false,
        lastScannedBlock: 0,
        currentChainHead: null,
        blockLag: null,
        lastSuccessfulScan: null,
        lastError: null,
      });
    }

    const health = await monitor.getHealth();
    res.json({
      timestamp: new Date().toISOString(),
      ...health,
    });
  } catch (err) {
    logger.error(
      { requestId: req.requestId, event: 'BLOCKCHAIN_HEALTH_FETCH_ERROR', error: err.message },
      'Error fetching monitor health'
    );
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * Get current blockchain metrics
 * GET /api/blockchain/metrics
 */
router.get('/metrics', authenticate, requireRole(['admin', 'support']), async (req, res) => {
  try {
    // getMetrics() returns the metrics object directly (no { data, error }).
    const metrics = req.blockchainMetrics.getMetrics();

    res.json({
      timestamp: new Date().toISOString(),
      metrics,
    });
  } catch (err) {
    logger.error(
      { requestId: req.requestId, event: 'BLOCKCHAIN_METRICS_FETCH_ERROR', error: err.message },
      'Error fetching metrics'
    );
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * Get active alerts with escalation status
 * GET /api/blockchain/alerts/active
 */
router.get('/alerts/active', authenticate, requireRole(['admin', 'support']), async (req, res) => {
  try {
    const activeAlerts = await req.escalationHandler.getActiveAlerts();

    res.json({
      timestamp: new Date().toISOString(),
      activeAlerts,
      count: activeAlerts.length,
    });
  } catch (err) {
    logger.error(
      { requestId: req.requestId, event: 'BLOCKCHAIN_ACTIVE_ALERTS_FETCH_ERROR', error: err.message },
      'Error fetching active alerts'
    );
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * Resolve an active alert
 * POST /api/blockchain/alerts/:alertId/resolve
 */
router.post('/alerts/:alertId/resolve', authenticate, requireRole(['admin', 'support']), async (req, res) => {
  try {
    const { alertId } = req.params;

    // Validate alertId format (prevent injection attacks)
    if (!alertId || typeof alertId !== 'string' || alertId.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(alertId)) {
      return res.status(400).json({ error: 'Invalid alert ID format' });
    }

    const resolved = await req.escalationHandler.resolveAlert(alertId);

    if (!resolved) {
      return res.status(404).json({ error: 'Alert not found or already resolved' });
    }

    res.json({
      message: 'Alert resolved successfully',
      alertId,
    });
  } catch (err) {
    logger.error(
      { requestId: req.requestId, event: 'BLOCKCHAIN_ALERT_RESOLVE_ERROR', alertId: req.params.alertId, error: err.message },
      'Error resolving alert'
    );
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * Get monitoring events with filtering
 * GET /api/blockchain/events?type=PAYMENT_RECEIVED&severity=CRITICAL&limit=50
 */
/**
 * @openapi
 * components:
 *   schemas:
 *     BlockchainMonitoringEvent:
 *       type: object
 *       required:
 *         - id
 *         - type
 *         - severity
 *       properties:
 *         id:
 *           type: integer
 *           format: int64
 *         type:
 *           type: string
 *           enum:
 *             - PAYMENT_RECEIVED
 *             - PAYMENT_RELEASED
 *             - BOOKING_CANCELLED
 *             - BOOKING_STARTED
 *             - BOOKING_DISPUTED
 *             - DISPUTE_RESOLVED
 *             - BOOKING_CREATED
 *             - BLOCKCHAIN_STATE_DIVERGENCE
 *             - SCAN_CHECKPOINT
 *             - INSURANCE_CLAIM_APPROVED
 *             - INSURANCE_CLAIM_REJECTED
 *             - GEOFENCE_BREACH
 *             - BALANCE_UPDATE_FAILED
 *             - SMART_CONTRACT_REVERT
 *         severity:
 *           type: string
 *           enum: [LOW, MEDIUM, HIGH, CRITICAL]
 *         data:
 *           type: object
 *           nullable: true
 *           additionalProperties: true
 *         created_at:
 *           type: string
 *           format: date-time
 *           nullable: true
 *     BlockchainMonitoringEventsResponse:
 *       type: object
 *       required:
 *         - timestamp
 *         - count
 *         - events
 *       properties:
 *         timestamp:
 *           type: string
 *           format: date-time
 *         count:
 *           type: integer
 *           minimum: 0
 *         events:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/BlockchainMonitoringEvent'
 */

/**
 * @openapi
 * /api/blockchain/events:
 *   get:
 *     tags: [Blockchain Monitoring]
 *     summary: List blockchain monitoring events
 *     description: Returns recent blockchain monitoring events for administrators and support users, with optional type and severity filters.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         required: false
 *         description: Filter by blockchain monitoring event type
 *         schema:
 *           type: string
 *           enum: [PAYMENT_RECEIVED, PAYMENT_RELEASED, BOOKING_CANCELLED, BOOKING_STARTED, BOOKING_DISPUTED, DISPUTE_RESOLVED, BOOKING_CREATED, BLOCKCHAIN_STATE_DIVERGENCE, SCAN_CHECKPOINT, INSURANCE_CLAIM_APPROVED, INSURANCE_CLAIM_REJECTED, GEOFENCE_BREACH, BALANCE_UPDATE_FAILED, SMART_CONTRACT_REVERT]
 *       - in: query
 *         name: severity
 *         required: false
 *         description: Filter by event severity
 *         schema:
 *           type: string
 *           enum: [LOW, MEDIUM, HIGH, CRITICAL]
 *       - in: query
 *         name: limit
 *         required: false
 *         description: Maximum number of events to return
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 1000
 *           default: 50
 *     responses:
 *       200:
 *         description: Blockchain monitoring events
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BlockchainMonitoringEventsResponse'
 *       400:
 *         description: Invalid event type, severity, or limit
 *       500:
 *         description: Failed to fetch blockchain monitoring events
 */
router.get('/events', authenticate, requireRole(['admin', 'support']), async (req, res) => {
  try {
    const { type, severity, limit = '50' } = req.query;

    // Validate and sanitize limit parameter
    const parsedLimit = parseInt(limit, 10);
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
      return res.status(400).json({ error: 'Invalid limit. Must be between 1 and 1000' });
    }

    // Validate event type if provided
    const validTypes = [
      'PAYMENT_RECEIVED',
      'PAYMENT_RELEASED',
      'BOOKING_CANCELLED',
      'BOOKING_STARTED',
      'BOOKING_DISPUTED',
      'DISPUTE_RESOLVED',
      'BOOKING_CREATED',
      'BLOCKCHAIN_STATE_DIVERGENCE',
      'SCAN_CHECKPOINT',
      'INSURANCE_CLAIM_APPROVED',
      'INSURANCE_CLAIM_REJECTED',
      'GEOFENCE_BREACH',
      'BALANCE_UPDATE_FAILED',
      'SMART_CONTRACT_REVERT',
    ];
    if (type && !validTypes.includes(type)) {
      return res.status(400).json({ error: 'Invalid event type' });
    }

    // Validate severity if provided
    const validSeverities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    if (severity && !validSeverities.includes(severity)) {
      return res.status(400).json({ error: 'Invalid severity level' });
    }

    const db = resolveSupabaseClient(req) || req.supabase || supabase;
    let query = db
      .from('blockchain_monitoring_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(parsedLimit);

    if (type) {
      query = query.eq('type', type);
    }

    if (severity) {
      query = query.eq('severity', severity);
    }

    const { data: events, error } = await query;

    if (error) {
      logger.error(
        { requestId: req.requestId, event: 'BLOCKCHAIN_EVENTS_FETCH_FAILED', error: error?.message || error },
        'Failed to fetch events'
      );
      return res.status(500).json({ error: 'Failed to fetch events' });
    }

    res.json({
      timestamp: new Date().toISOString(),
      count: events.length,
      events,
    });
  } catch (err) {
    logger.error(
      { requestId: req.requestId, event: 'BLOCKCHAIN_EVENTS_FETCH_ERROR', error: err.message },
      'Error fetching events'
    );
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * Get escalation history for an alert
 * GET /api/blockchain/escalations/:alertId
 */
router.get('/escalations/:alertId', authenticate, requireRole(['admin', 'support']), async (req, res) => {
  try {
    const { alertId } = req.params;

    // Validate alertId format (prevent injection attacks)
    if (!alertId || typeof alertId !== 'string' || alertId.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(alertId)) {
      return res.status(400).json({ error: 'Invalid alert ID format' });
    }

    const db = resolveSupabaseClient(req) || req.supabase || supabase;
    const { data: escalation, error } = await db
      .from('blockchain_escalations')
      .select('*')
      .eq('alert_id', alertId)
      .single();

    if (error) {
      logger.error(
        { requestId: req.requestId, event: 'BLOCKCHAIN_ESCALATION_FETCH_FAILED', alertId, error: error?.message || error },
        'Failed to fetch escalation'
      );
      return res.status(404).json({ error: 'Escalation not found' });
    }

    res.json({
      timestamp: new Date().toISOString(),
      escalation,
    });
  } catch (err) {
    logger.error(
      { requestId: req.requestId, event: 'BLOCKCHAIN_ESCALATION_FETCH_ERROR', alertId: req.params.alertId, error: err.message },
      'Error fetching escalation'
    );
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
