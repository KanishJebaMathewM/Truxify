import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import logger from '../middleware/logger.js';

const router = express.Router();

/**
 * Get current blockchain metrics
 * GET /api/blockchain/metrics
 */
router.get('/metrics', authenticate, requireRole(['admin', 'support']), async (req, res) => {
  try {
    const { data: metrics, error } = await req.blockchainMetrics.getMetrics();

    if (error) {
      logger.error('Failed to fetch blockchain metrics:', error);
      return res.status(500).json({ error: 'Failed to fetch metrics' });
    }

    res.json({
      timestamp: new Date().toISOString(),
      metrics,
    });
  } catch (err) {
    logger.error('Error fetching metrics:', err.message);
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
    logger.error('Error fetching active alerts:', err.message);
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
    logger.error('Error resolving alert:', err.message);
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

    let query = req.supabase
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
      logger.error('Failed to fetch events:', error);
      return res.status(500).json({ error: 'Failed to fetch events' });
    }

    res.json({
      timestamp: new Date().toISOString(),
      count: events.length,
      events,
    });
  } catch (err) {
    logger.error('Error fetching events:', err.message);
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

    const { data: escalation, error } = await req.supabase
      .from('blockchain_escalations')
      .select('*')
      .eq('alert_id', alertId)
      .single();

    if (error) {
      logger.error('Failed to fetch escalation:', error);
      return res.status(404).json({ error: 'Escalation not found' });
    }

    res.json({
      timestamp: new Date().toISOString(),
      escalation,
    });
  } catch (err) {
    logger.error('Error fetching escalation:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
