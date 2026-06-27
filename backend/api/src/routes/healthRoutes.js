import express from 'express';
import { supabase, mongoDb, redisClient, firebaseAdmin } from '../config/db.js';
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

function checkPolygon() {
  return process.env.POLYGON_RPC_URL ? 'configured' : 'not_configured';
}

const CRITICAL_UNHEALTHY = new Set(['failed', 'not_configured']);

// GET /api/health — full dependency check; returns 503 when a critical service fails
router.get('/', async (req, res) => {
  const [supabaseStatus, mongoStatus, redisStatus] = await Promise.all([
    checkSupabase(),
    checkMongo(),
    checkRedis(),
  ]);

  const services = {
    supabase: supabaseStatus,
    mongodb: mongoStatus,
    redis: redisStatus,
    firebase: checkFirebase(),
    polygon: checkPolygon(),
  };

  const criticalFailed =
    CRITICAL_UNHEALTHY.has(supabaseStatus) || CRITICAL_UNHEALTHY.has(mongoStatus);

  const status = criticalFailed ? 'degraded' : 'ok';
  const httpStatus = criticalFailed ? 503 : 200;

  return res.status(httpStatus).json({
    status,
    services,
    uptime: process.uptime(),
  });
});

// GET /api/health/live — liveness probe; always 200 as long as the process is up
router.get('/live', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

export default router;
