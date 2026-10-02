import express from 'express';
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
  // Probe through the service-role client: anon privileges on profiles are
  // revoked by revoke_anon_privileges.sql, so an anon-keyed probe would always
  // report 42501 permission denied even when Supabase is reachable.
  const client = supabaseAdmin || supabase;
  if (!client) return 'not_configured';
  try {
    const { error } = await withTimeout(
      client.from('profiles').select('id').limit(1)
    );
    return error ? 'failed' : 'connected';
  } catch (err) {
    logger.error({ event: 'HEALTH_SUPABASE_ERROR', error: err?.message }, '[health] Supabase check failed');
    return 'failed';
  }
}

async function checkMongo() {
  if (!mongoDb) return 'not_configured';
  try {
    await withTimeout(mongoDb.admin().ping());
    return 'connected';
  } catch (err) {
    logger.error({ event: 'HEALTH_MONGO_ERROR', error: err?.message }, '[health] MongoDB check failed');
    return 'failed';
  }
}

async function checkRedis() {
  if (!redisClient) return 'not_configured';
  try {
    const reply = await withTimeout(redisClient.ping());
    return reply === 'PONG' ? 'connected' : 'failed';
  } catch (err) {
    logger.error({ event: 'HEALTH_REDIS_ERROR', error: err?.message }, '[health] Redis check failed');
    return 'failed';
  }
}
router.get('/health', async (req, res) => {
  try {
    // Replaced console.log with structured logger.info
    logger.info({ requestId: req.id }, 'Health check probe requested');

    const healthStatus = {
      status: 'UP',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };

    res.status(200).json(healthStatus);
  } catch (err) {
    logger.error({ event: 'HEALTH_ESCROW_ERROR', error: err?.message }, '[Health] checkEscrow failed');
    return 'failed';
  }
}

function checkPolygon() {
  return process.env.POLYGON_RPC_URL ? 'configured' : 'not_configured';
}

const CRITICAL_UNHEALTHY = new Set(['failed', 'not_configured']);
// MongoDB is optional telemetry storage: only a configured-but-unreachable
// instance should affect dependency health.
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

    // Redis is a non-critical cache: every consumer has an in-memory fallback,
    // so a Redis failure is reported in `services` but does not degrade overall
    // health. Supabase and MongoDB remain critical.
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
    // Replaced console.error with structured logger.error
    logger.error({ err, requestId: req.id }, 'Health check probe failed');
    res.status(500).json({ status: 'DOWN', error: 'Internal Health Check Error' });
  }
});

router.get('/diagnostics', async (req, res) => {
  try {
    const result = await aggregator.aggregate();
    // 200 = system operational (healthy or degraded with non-critical failures)
    // 503 = system not operational (critical services down)
    const httpStatus = result.status === 'unhealthy' ? 503 : 200;
    logger.info({ event: 'HEALTH_AGGREGATION_SUCCESS', status: result.status }, 'Aggregated health check completed.');
    return res.status(httpStatus).json(result);
  } catch (err) {
    logger.error(
      { event: 'HEALTH_AGGREGATION_ERROR', requestId: req.requestId || req.id, error: err && err.message },
      '[health] Aggregated health check failed',
    );
    return res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'health aggregation failed',
    });
  }
});
    logger.info({ requestId: req.id }, 'Diagnostics check requested');

    const diagnosticsInfo = {
      memoryUsage: process.memoryUsage(),
      nodeVersion: process.version,
      env: process.env.NODE_ENV || 'development',
    };

    res.status(200).json(diagnosticsInfo);
  } catch (err) {
    logger.error({ err, requestId: req.id }, 'Diagnostics check failed');
    res.status(500).json({ status: 'ERROR', error: 'Internal Diagnostics Error' });
  }
});

export default router;
