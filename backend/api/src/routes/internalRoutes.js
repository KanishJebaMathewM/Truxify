/**
 * Internal B2B API routes consumed by the n8n "Truxify Emergency Smart Contract
 * Circuit Breaker" workflow (automation/n8n/workflows/circuit_breaker.json).
 *
 *   GET  /api/internal/escrow-velocity  — reports escrow event counts over a
 *                                         rolling window and whether the rate
 *                                         exceeds the anomaly threshold.
 *   POST /api/internal/pause-escrow     — opens (or closes) the escrow circuit
 *                                         breaker; while open, every on-chain
 *                                         escrow submission in services/escrow.js
 *                                         is refused.
 *
 * Both endpoints are gated by requireApiKey (x-api-key header / api_key query
 * against VALID_API_KEYS) so they are only reachable by authenticated B2B
 * callers such as the n8n workflow.
 */

import express from 'express';
import logger from '../middleware/logger.js';
import { supabase, supabaseAdmin } from '../config/db.js';
import {
  setEscrowPaused,
  getPauseState,
} from '../services/escrowCircuitBreaker.js';

const router = express.Router();

const DEFAULT_WINDOW_MINUTES = 5;
const DEFAULT_ANOMALY_THRESHOLD = 20;

function intFromEnv(raw, fallback) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getDbClient() {
  return supabaseAdmin || supabase;
}

/**
 * @openapi
 * /api/internal/escrow-velocity:
 *   get:
 *     tags: [Internal]
 *     summary: Escrow velocity monitor
 *     description: Counts escrow deposits, releases and refunds within a rolling window and reports whether the combined rate exceeds the anomaly threshold configured via ESCROW_VELOCITY_WINDOW_MINUTES / ESCROW_ANOMALY_THRESHOLD.
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Escrow velocity snapshot
 *       401:
 *         description: Missing or invalid API key
 *       503:
 *         description: Supabase not configured
 */
router.get('/escrow-velocity', async (req, res) => {
  try {
    const client = getDbClient();
    if (!client) {
      return res.status(503).json({ error: 'Supabase is not configured.' });
    }

    const windowMinutes = intFromEnv(process.env.ESCROW_VELOCITY_WINDOW_MINUTES, DEFAULT_WINDOW_MINUTES);
    const threshold = intFromEnv(process.env.ESCROW_ANOMALY_THRESHOLD, DEFAULT_ANOMALY_THRESHOLD);
    const cutoff = new Date(Date.now() - windowMinutes * 60_000).toISOString();

    const [deposits, releases, refunds] = await Promise.all([
      client.from('orders').select('id', { count: 'exact', head: true }).gte('escrow_deposited_at', cutoff),
      client.from('orders').select('id', { count: 'exact', head: true }).gte('escrow_released_at', cutoff),
      client.from('orders').select('id', { count: 'exact', head: true }).gte('escrow_refunded_at', cutoff),
    ]);

    if (deposits.error || releases.error || refunds.error) {
      logger.error(
        {
          event: 'ESCROW_VELOCITY_QUERY_ERROR',
          depositsError: deposits.error && deposits.error.message,
          releasesError: releases.error && releases.error.message,
          refundsError: refunds.error && refunds.error.message,
        },
        '[internal] Escrow velocity query failed.'
      );
      return res.status(502).json({ error: 'Failed to read escrow velocity.' });
    }

    const counts = {
      deposits: deposits.count || 0,
      releases: releases.count || 0,
      refunds: refunds.count || 0,
    };
    counts.total = counts.deposits + counts.releases + counts.refunds;

    const pauseState = await getPauseState();

    return res.json({
      isAnomalyDetected: counts.total >= threshold,
      windowMinutes,
      threshold,
      counts,
      escrowPaused: pauseState.paused,
      pausedAt: pauseState.pausedAt,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error(
      { err: err && err.message, event: 'ESCROW_VELOCITY_ERROR' },
      '[internal] Escrow velocity check failed.'
    );
    return res.status(500).json({ error: 'Failed to compute escrow velocity.' });
  }
});

/**
 * @openapi
 * /api/internal/pause-escrow:
 *   post:
 *     tags: [Internal]
 *     summary: Open or close the escrow circuit breaker
 *     description: Sets the Redis-backed pause flag that services/escrow.js consults before every on-chain escrow submission. Send {"paused": false} to close the circuit.
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               paused:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       200:
 *         description: Circuit breaker state updated
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Failed to persist pause state
 */
router.post('/pause-escrow', async (req, res) => {
  try {
    const paused = req.body?.paused === true;
    const result = await setEscrowPaused(paused);
    return res.json({
      paused: result.paused,
      updatedAt: result.updatedAt,
      persisted: result.persisted !== false,
    });
  } catch (err) {
    logger.error(
      { err: err && err.message, event: 'ESCROW_PAUSE_ERROR' },
      '[internal] Failed to update escrow circuit breaker.'
    );
    return res.status(500).json({ error: 'Failed to update escrow circuit breaker.' });
  }
});

export default router;
