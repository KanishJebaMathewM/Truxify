/**
 * @openapi
 * components:
 *   schemas:
 *     HealthResponse:
 *       type: object
 *       properties:
 *         status:
 *           type: string
 *           enum: [ok, degraded]
 *         services:
 *           type: object
 *           properties:
 *             supabase:
 *               type: string
 *               enum: [connected, failed, not_configured]
 *             mongodb:
 *               type: string
 *               enum: [connected, failed, not_configured]
 *             redis:
 *               type: string
 *               enum: [connected, failed, not_configured]
 *             firebase:
 *               type: string
 *               enum: [configured, not_configured]
 *             polygon:
 *               type: string
 *               enum: [configured, not_configured]
 *         uptime:
 *           type: number
 *         memory:
 *           type: object
 *           properties:
 *             rss:
 *               type: number
 *             heapTotal:
 *               type: number
 *             heapUsed:
 *               type: number
 *             external:
 *               type: number
 *     LivenessResponse:
 *       type: object
 *       properties:
 *         status:
 *           type: string
 *           enum: [ok]
 *         uptime:
 *           type: number
 *     ReadinessResponse:
 *       type: object
 *       properties:
 *         status:
 *           type: string
 *           enum: [ready, not_ready]
 *         services:
 *           type: object
 */

import express from 'express';
import { supabase, supabaseAdmin, mongoDb, redisClient, firebaseAdmin } from '../config/db.js';
import { healthLimiter } from '../middleware/rateLimiter.js';
import { checkEscrowHealth } from '../services/escrow.js';
import logger from '../middleware/logger.js';
import { createDefaultAggregator } from '../core/health/index.js';
import { captureDebugException } from '../middleware/sentry.js';
import express from 'express';
import * as Sentry from '@sentry/node';
import logger from '../middleware/logger.js';

const router = express.Router();

// ... existing health check routes ...

/**
 * GET /api/health/sentry-debug
 * Triggers a test exception capture via Sentry for instrumentation verification.
 */
router.get('/sentry-debug', async (req, res) => {
  try {
    const testError = new Error('Sentry Test Error from Truxify Node.js Backend');
    
    // Explicitly capture exception with Sentry if initialized
    if (Sentry && typeof Sentry.captureException === 'function') {
      const eventId = Sentry.captureException(testError, {
        tags: {
          endpoint: '/api/health/sentry-debug',
          environment: process.env.NODE_ENV || 'development'
        },
        extra: {
          timestamp: new Date().toISOString(),
          requestedBy: req.ip
        }
      });

      logger.info({ eventId }, 'Sentry debug test exception captured successfully');
      
      return res.status(200).json({
        success: true,
        message: 'Sentry test exception captured and sent successfully.',
        sentryEventId: eventId
      });
    } else {
      // Fallback if Sentry is not active in the current environment
      logger.warn('Sentry is not initialized; test error logged locally.');
      throw testError;
    }
  } catch (err) {
    logger.error({ error: err.message }, 'Failed to process Sentry debug endpoint');
    return res.status(500).json({
      success: false,
      error: 'Sentry SDK not configured or capture failed',
      details: err.message
    });
  }
});

export default router;
const router = express.Router();

const DEFAULT_TIMEOUT_MS = 400;
const _parsedTimeout = Number(process.env.HEALTHCHECK_TIMEOUT_MS);
const CHECK_TIMEOUT_MS =
  Number.isFinite(_parsedTimeout) && _parsedTimeout > 0 ? _parsedTimeout : DEFAULT_TIMEOUT_MS;

function withTimeout(promise) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('healthcheck timeout')), CHECK_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function checkSupabase() {
  const client = supabaseAdmin || supabase;
  if (!client) return 'not_configured';
  try {
    const { error } = await withTimeout(
      client.from('profiles').select('id').limit(1)
    );
    return error ? 'failed' : 'connected';
  } catch (err) {
    logger.error({ event: 'HEALTH_SUPABASE_CHECK_FAILED', error: err?.message }, 'Supabase check failed');
    return 'failed';
  }
}

async function checkMongo() {
  if (!mongoDb) return 'not_configured';
  try {
    await withTimeout(mongoDb.admin().ping());
    return 'connected';
  } catch (err) {
    logger.error({ event: 'HEALTH_MONGODB_CHECK_FAILED', error: err?.message }, 'MongoDB check failed');
    return 'failed';
  }
}

async function checkRedis() {
  if (!redisClient) return 'not_configured';
  try {
    const reply = await withTimeout(redisClient.ping());
    return reply === 'PONG' ? 'connected' : 'failed';
  } catch (err) {
    logger.error({ event: 'HEALTH_REDIS_CHECK_FAILED', error: err?.message }, 'Redis check failed');
    return 'failed';
  }
}

function checkFirebase() {
  return firebaseAdmin ? 'configured' : 'not_configured';
}

async function checkEscrow() {
  try {
    const result = await checkEscrowHealth();
    return result.status;
  } catch (err) {
    logger.error({ event: 'HEALTH_ESCROW_CHECK_FAILED', error: err?.message || err }, 'checkEscrow failed');
    return 'failed';
  }
}

function checkPolygon() {
  return process.env.POLYGON_RPC_URL ? 'configured' : 'not_configured';
}

const CRITICAL_UNHEALTHY = new Set(['failed', 'not_configured']);
const CRITICAL_UNHEALTHY_MONGO = new Set(['failed']);

/**
 * @openapi
 * /api/health:
 *   get:
 *     tags: [Health]
 *     summary: Full system health check
 *     description: Returns the status of all dependent services (Supabase, optional MongoDB telemetry, Redis, Firebase, Polygon). Returns 503 when a critical service fails.
 *     security:
 *       - {}
 *     responses:
 *       200:
 *         description: All critical services healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 *       503:
 *         description: One or more critical services degraded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 */
router.get('/', healthLimiter, async (req, res) => {
  try {
    logger.info({ event: 'HEALTH_CHECK_REQUESTED' }, 'Health check probe received.');

    const [supabaseStatus, mongoStatus, redisStatus, escrowStatus] = await Promise.all([
      checkSupabase(),
      checkMongo(),
      checkRedis(),
      checkEscrow(),
    ]);

    const services = {
      supabase: supabaseStatus,
      mongodb: mongoStatus,
      redis: redisStatus,
      escrow: escrowStatus,
      firebase: checkFirebase(),
      polygon: checkPolygon(),
    };

    const criticalFailed =
      CRITICAL_UNHEALTHY.has(supabaseStatus) ||
      CRITICAL_UNHEALTHY_MONGO.has(mongoStatus);

    const status = criticalFailed ? 'degraded' : 'ok';
    const httpStatus = criticalFailed ? 503 : 200;

    logger.info({ event: 'HEALTH_CHECK_SUCCESS', status }, 'Health check completed successfully.');
    return res.status(httpStatus).json({
      status,
      services,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    });
  } catch (err) {
    logger.error({ event: 'HEALTH_CHECK_ERROR', error: err?.message }, 'Health check failed with unhandled exception.');
    return res.status(503).json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      error: err?.message,
    });
  }
});

/**
 * @openapi
 * /api/health/live:
 *   get:
 *     tags: [Health]
 *     summary: Kubernetes liveness probe
 *     description: Always returns 200 as long as the process is running. Does not check dependencies.
 *     security:
 *       - {}
 *     responses:
 *       200:
 *         description: Process is alive
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LivenessResponse'
 */
router.get('/live', healthLimiter, (req, res) => {
  logger.info({ event: 'HEALTH_LIVENESS_PROBE' }, 'Liveness probe accessed.');
  return res.json({ status: 'ok', uptime: process.uptime() });
});

/**
 * @openapi
 * /api/health/ready:
 *   get:
 *     tags: [Health]
 *     summary: Kubernetes readiness probe
 *     description: Returns 200 when Supabase is reachable and optional MongoDB telemetry is either reachable or disabled. Returns 503 if Supabase is unavailable or configured MongoDB is down.
 *     security:
 *       - {}
 *     responses:
 *       200:
 *         description: All critical services ready
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ReadinessResponse'
 *       503:
 *         description: One or more critical services not ready
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ReadinessResponse'
 */
router.get('/ready', healthLimiter, async (req, res) => {
  const [supabaseStatus, mongoStatus, redisStatus] = await Promise.all([
    checkSupabase(),
    checkMongo(),
    checkRedis(),
  ]);

  const services = {
    supabase: supabaseStatus,
    mongodb: mongoStatus,
    redis: redisStatus,
  };

  const criticalFailed =
    CRITICAL_UNHEALTHY.has(supabaseStatus) ||
    CRITICAL_UNHEALTHY_MONGO.has(mongoStatus);

  if (criticalFailed) {
    logger.warn({ event: 'HEALTH_READINESS_FAILED', services }, 'Readiness probe failed.');
    return res.status(503).json({ status: 'not_ready', services });
  }

  logger.info({ event: 'HEALTH_READINESS_SUCCESS' }, 'Readiness probe passed.');
  return res.status(200).json({ status: 'ready', services });
});

// ============================================================================
// Centralized Health Aggregation Endpoint
// ============================================================================

const aggregator = createDefaultAggregator();

/**
 * @openapi
 * /api/health/full:
 *   get:
 *     tags: [Health]
 *     summary: Centralized health aggregation for all distributed components
 *     description: >
 *       Returns a unified health response covering all major backend services
 *       including databases, message queues, ML engine, GraphQL gateway,
 *       WebSocket server, blockchain, and background workers.
 *     security:
 *       - {}
 *     responses:
 *       200:
 *         description: All critical services healthy
 *       503:
 *         description: One or more critical services degraded
 */
router.get('/full', healthLimiter, async (req, res) => {
  try {
    const result = await aggregator.aggregate();
    const httpStatus = result.status === 'unhealthy' ? 503 : 200;
    logger.info({ event: 'HEALTH_AGGREGATION_SUCCESS', status: result.status }, 'Aggregated health check completed.');
    return res.status(httpStatus).json(result);
  } catch (err) {
    logger.error(
      { event: 'HEALTH_AGGREGATED_CHECK_FAILED', requestId: req.requestId || req.id, error: err && err.message },
      'Aggregated health check failed',
    );
    return res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'health aggregation failed',
    });
  }
});

router.get('/sentry-debug', healthLimiter, (req, res) => {
  if (process.env.SENTRY_DEBUG_ENABLED !== 'true' || process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  const err = new Error('Sentry Test Error from Node.js Backend');
  err.name = 'SentryDebugTestError';
  const eventId = captureDebugException(err);

  if (eventId) {
    return res.status(200).json({ sent: true, eventId });
  }
  return res.status(503).json({ sent: false, error: 'Sentry is not configured (SENTRY_DSN unset).' });
});

export default router;
