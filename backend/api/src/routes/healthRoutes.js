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
import { supabase, mongoDb, redisClient, firebaseAdmin } from '../config/db.js';
import { healthLimiter } from '../middleware/rateLimiter.js';
import { checkEscrowHealth } from '../services/escrow.js';
import logger from '../middleware/logger.js';

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
  if (!supabase) return 'not_configured';
  try {
    const { error } = await withTimeout(
      supabase.from('profiles').select('id').limit(1)
    );
    return error ? 'failed' : 'connected';
  } catch (err) {
    logger.error('[health] Supabase check failed:', err.message);
    return 'failed';
  }
}

async function checkMongo() {
  if (!mongoDb) return 'not_configured';
  try {
    await withTimeout(mongoDb.admin().ping());
    return 'connected';
  } catch (err) {
    logger.error('[health] MongoDB check failed:', err.message);
    return 'failed';
  }
}

async function checkRedis() {
  if (!redisClient) return 'not_configured';
  try {
    const reply = await withTimeout(redisClient.ping());
    return reply === 'PONG' ? 'connected' : 'failed';
  } catch (err) {
    logger.error('[health] Redis check failed:', err.message);
    return 'failed';
  }
}

function checkFirebase() {
  return firebaseAdmin ? 'configured' : 'not_configured';
}

async function checkEscrow() {
  const result = await checkEscrowHealth();
  return result.status;
}

function checkPolygon() {
  return process.env.POLYGON_RPC_URL ? 'configured' : 'not_configured';
}

const CRITICAL_UNHEALTHY = new Set(['failed', 'not_configured']);
// Optional services treat 'not_configured' as healthy — only actual failures are critical.
const CRITICAL_UNHEALTHY_OPTIONAL = new Set(['failed']);

/**
 * @openapi
 * /api/health:
 *   get:
 *     tags: [Health]
 *     summary: Full system health check
 *     description: Returns the status of all dependent services (Supabase, MongoDB, Redis, Firebase, Polygon). Returns 503 when a critical service fails.
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

  // Redis is a non-critical cache: every consumer has an in-memory fallback,
  // so a Redis failure is reported in `services` but does not degrade overall
  // health. Supabase and MongoDB remain critical.
  const criticalFailed =
    CRITICAL_UNHEALTHY.has(supabaseStatus) ||
    CRITICAL_UNHEALTHY_OPTIONAL.has(mongoStatus);

  const status = criticalFailed ? 'degraded' : 'ok';
  const httpStatus = criticalFailed ? 503 : 200;

  return res.status(httpStatus).json({
    status,
    services,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
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
  res.json({ status: 'ok', uptime: process.uptime() });
});

/**
 * @openapi
 * /api/health/ready:
 *   get:
 *     tags: [Health]
 *     summary: Kubernetes readiness probe
 *     description: Returns 200 when all critical services (Supabase, MongoDB) are reachable. Returns 503 if any critical dependency is down.
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
    CRITICAL_UNHEALTHY_OPTIONAL.has(mongoStatus);

  if (criticalFailed) {
    return res.status(503).json({ status: 'not_ready', services });
  }

  return res.status(200).json({ status: 'ready', services });
});

export default router;
