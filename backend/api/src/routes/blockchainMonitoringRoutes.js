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

/**
 * @swagger
 * components:
 *   schemas:
 *     BlockchainHealth:
 *       type: object
 *       properties:
 *         timestamp: { type: string, format: date-time }
 *         status: { type: string }
 *         running: { type: boolean }
 *         lastScannedBlock: { type: integer }
 *         currentChainHead: { type: integer, nullable: true }
 *         blockLag: { type: integer, nullable: true }
 *         lastSuccessfulScan: { type: string, format: date-time, nullable: true }
 *         lastError: { type: string, nullable: true }
 *     BlockchainMetricsResponse:
 *       type: object
 *       required: [timestamp, metrics]
 *       properties:
 *         timestamp: { type: string, format: date-time }
 *         metrics: { type: object, additionalProperties: true }
 *     ActiveAlertsResponse:
 *       type: object
 *       required: [timestamp, activeAlerts, count]
 *       properties:
 *         timestamp: { type: string, format: date-time }
 *         activeAlerts: { type: array, items: { type: object, additionalProperties: true } }
 *         count: { type: integer, minimum: 0 }
 *     ResolveAlertResponse:
 *       type: object
 *       required: [message, alertId]
 *       properties:
 *         message: { type: string, example: Alert resolved successfully }
 *         alertId: { type: string }
 *     BlockchainEventsResponse:
 *       type: object
 *       required: [timestamp, count, events]
 *       properties:
 *         timestamp: { type: string, format: date-time }
 *         count: { type: integer, minimum: 0 }
 *         events: { type: array, items: { type: object, additionalProperties: true } }
 *     EscalationResponse:
 *       type: object
 *       required: [timestamp, escalation]
 *       properties:
 *         timestamp: { type: string, format: date-time }
 *         escalation: { type: object, additionalProperties: true }
 */

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
 * @swagger
 * /api/blockchain/health:
 *   get:
 *     summary: Get blockchain monitor health
 *     tags: [Blockchain Monitoring]
 *     responses:
 *       200:
 *         description: Current monitor health and block lag.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/BlockchainHealth' }
 *       500:
 *         description: Failed to fetch monitor health.
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
 * @swagger
 * /api/blockchain/metrics:
 *   get:
 *     summary: Get current blockchain metrics
 *     tags: [Blockchain Monitoring]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Current metrics.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/BlockchainMetricsResponse' }
 *       401:
 *         description: Authentication required.
 *       403:
 *         description: Admin or support role required.
 *       500:
 *         description: Failed to fetch metrics.
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
 * @swagger
 * /api/blockchain/alerts/active:
 *   get:
 *     summary: Get active blockchain alerts
 *     tags: [Blockchain Monitoring]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Active alerts and count.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ActiveAlertsResponse' }
 *       401:
 *         description: Authentication required.
 *       403:
 *         description: Admin or support role required.
 *       500:
 *         description: Failed to fetch active alerts.
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
 * @swagger
 * /api/blockchain/alerts/{alertId}/resolve:
 *   post:
 *     summary: Resolve an active blockchain alert
 *     tags: [Blockchain Monitoring]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: alertId
 *         required: true
 *         schema: { type: string, pattern: '^[a-zA-Z0-9_-]+
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
 * @swagger
 * /api/blockchain/events:
 *   get:
 *     summary: Get blockchain monitoring events
 *     tags: [Blockchain Monitoring]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [PAYMENT_RECEIVED, PAYMENT_RELEASED, BOOKING_CANCELLED, BOOKING_STARTED, BOOKING_DISPUTED, DISPUTE_RESOLVED, BOOKING_CREATED, BLOCKCHAIN_STATE_DIVERGENCE, SCAN_CHECKPOINT, INSURANCE_CLAIM_APPROVED, INSURANCE_CLAIM_REJECTED, GEOFENCE_BREACH, BALANCE_UPDATE_FAILED, SMART_CONTRACT_REVERT]
 *       - in: query
 *         name: severity
 *         schema: { type: string, enum: [LOW, MEDIUM, HIGH, CRITICAL] }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 1000, default: 50 }
 *     responses:
 *       200:
 *         description: Filtered monitoring events.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/BlockchainEventsResponse' }
 *       400:
 *         description: Invalid filter or limit.
 *       401:
 *         description: Authentication required.
 *       403:
 *         description: Admin or support role required.
 *       500:
 *         description: Failed to fetch events.
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
 * @swagger
 * /api/blockchain/escalations/{alertId}:
 *   get:
 *     summary: Get escalation history for an alert
 *     tags: [Blockchain Monitoring]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: alertId
 *         required: true
 *         schema: { type: string, pattern: '^[a-zA-Z0-9_-]+
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
, maxLength: 100 }
 *     responses:
 *       200:
 *         description: Alert resolved successfully.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ResolveAlertResponse' }
 *       400:
 *         description: Invalid alert ID.
 *       401:
 *         description: Authentication required.
 *       403:
 *         description: Admin or support role required.
 *       404:
 *         description: Alert not found or already resolved.
 *       500:
 *         description: Failed to resolve alert.
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
, maxLength: 100 }
 *     responses:
 *       200:
 *         description: Escalation history.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/EscalationResponse' }
 *       400:
 *         description: Invalid alert ID.
 *       401:
 *         description: Authentication required.
 *       403:
 *         description: Admin or support role required.
 *       404:
 *         description: Escalation not found.
 *       500:
 *         description: Failed to fetch escalation.
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
, maxLength: 100 }
 *     responses:
 *       200:
 *         description: Alert resolved successfully.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ResolveAlertResponse' }
 *       400:
 *         description: Invalid alert ID.
 *       401:
 *         description: Authentication required.
 *       403:
 *         description: Admin or support role required.
 *       404:
 *         description: Alert not found or already resolved.
 *       500:
 *         description: Failed to resolve alert.
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
