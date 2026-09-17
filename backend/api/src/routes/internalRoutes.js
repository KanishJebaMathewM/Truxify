/**
 * Internal B2B API routes consumed by the n8n automation workflows
 * (automation/n8n/workflows/).
 *
 *   GET  /api/internal/escrow-velocity  — reports escrow event counts over a
 *                                         rolling window and whether the rate
 *                                         exceeds the anomaly threshold.
 *   POST /api/internal/pause-escrow     — opens (or closes) the escrow circuit
 *                                         breaker; while open, every on-chain
 *                                         escrow submission in services/escrow.js
 *                                         is refused.
 *   POST /api/internal/defensive-pause  — one-way emergency open of the same
 *                                         circuit breaker, called by the
 *                                         security sentinel workflow when it
 *                                         matches a flash-loan/frontrun pattern
 *                                         in the Polygon mempool.
 *
 * Every endpoint is gated by requireApiKey (x-api-key header against
 * VALID_API_KEYS) at the mount in index.js, so they are only reachable by
 * authenticated B2B callers such as the n8n workflows.
 *
 * Closing the circuit is operator-only: POST /pause-escrow {"paused": false}
 * additionally requires the dedicated ESCROW_OPERATOR_API_KEY in the same
 * x-api-key header (the key must also be listed in VALID_API_KEYS so
 * requireApiKey authenticates it). Other valid internal keys are answered
 * 403, and unconfigured ESCROW_OPERATOR_API_KEY fails closed with 403.
 */

import express from 'express';
import logger from '../middleware/logger.js';
import { requireEscrowOperatorKey, safeCompare } from '../middleware/apiKey.js';
import { supabase, supabaseAdmin } from '../config/db.js';
import {
  setEscrowPaused,
  getPauseState,
} from '../services/escrowCircuitBreaker.js';
import { setEscrowContractPaused } from '../services/escrow.js';

const router = express.Router();

const DEFAULT_WINDOW_MINUTES = 5;
const DEFAULT_ANOMALY_THRESHOLD = 20;

function intFromEnv(raw, fallback) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getDbClient() {
  return supabaseAdmin;
}

/**
 * Escrow operator authorization.
 *
 * POST /api/internal/pause-escrow with {"paused": false} re-enables on-chain
 * escrow submissions, so it must not be reachable by every key in
 * VALID_API_KEYS — telemetry pollers and automation callers authenticate
 * with the same shared internal key. Closing the circuit therefore
 * additionally requires the dedicated ESCROW_OPERATOR_API_KEY, presented in
 * the same x-api-key header requireApiKey authenticates (which means the
 * operator key must also be listed in VALID_API_KEYS).
 *
 * Fails closed: when ESCROW_OPERATOR_API_KEY is not configured there is no
 * operator and every unpause attempt is refused (403). The presented key is
 * compared with safeCompare and never logged.
 */
function isEscrowOperatorRequest(req) {
  const operatorKey = process.env.ESCROW_OPERATOR_API_KEY;
  if (!operatorKey) return false;

  const headerName = (process.env.API_KEY_HEADER || 'x-api-key').toLowerCase();
  const presented = req.headers?.[headerName];
  return typeof presented === 'string' && safeCompare(presented, operatorKey);
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
 *     description: Sets the Redis-backed pause flag that services/escrow.js consults before every on-chain escrow submission. Send {"paused": false} to close the circuit. Closing is operator-only: it additionally requires the dedicated ESCROW_OPERATOR_API_KEY in the same x-api-key header (the key must also be listed in VALID_API_KEYS); any other valid internal key is answered 403, and the unpause fails closed with 403 when ESCROW_OPERATOR_API_KEY is not configured.
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
 *       403:
 *         description: The caller holds a valid internal API key but not the dedicated escrow operator key (also returned when ESCROW_OPERATOR_API_KEY is not configured)
 *       500:
 *         description: Failed to persist pause state
 *       502:
 *         description: Failed to confirm on-chain pause
 */
router.post('/pause-escrow', requireEscrowOperatorKey, async (req, res) => {
  try {
    const raw = req.body?.paused;
    const unpause = raw === false || raw === 'false' || raw === 0 || raw === '0' || raw === null;

    // Closing the circuit is the privileged direction: it re-enables on-chain
    // escrow submissions, so it must not be reachable by every key in
    // VALID_API_KEYS — telemetry pollers and the n8n sentinel authenticate
    // with the same shared internal key. Unpausing therefore additionally
    // requires the dedicated ESCROW_OPERATOR_API_KEY, and the check fails
    // closed when that key is not configured. Opening the circuit (the
    // default) keeps the plain requireApiKey behavior.
    if (unpause && !isEscrowOperatorRequest(req)) {
      logger.warn(
        { event: 'ESCROW_UNPAUSE_FORBIDDEN', path: req.originalUrl },
        '[internal] Escrow unpause rejected — caller does not hold the escrow operator key.'
      );
      return res.status(403).json({
        error: 'Forbidden: closing the escrow circuit breaker requires the escrow operator key.',
      });
    }

    const paused = raw === undefined ? true : !unpause;

    const result = await setEscrowPaused(paused);
    const onChainResult = await setEscrowContractPaused(paused);

    if (onChainResult.error) {
      const redisStatus = result.persisted === false ? 'failed' : 'completed';
      const action = paused ? 'pause' : 'unpause';
      return res.status(502).json({
        error: `Redis ${action} ${redisStatus}, but on-chain ${action} failed.`,
        onChainError: onChainResult.error,
        paused: result.paused,
        persisted: result.persisted !== false,
      });
    }

    return res.json({
      paused: result.paused,
      updatedAt: result.updatedAt,
      persisted: result.persisted !== false,
      onChain: {
        success: true,
        txHash: onChainResult.txHash,
        alreadyInState: onChainResult.alreadyInState,
      }
    });
  } catch (err) {
    logger.error(
      { err: err && err.message, event: 'ESCROW_PAUSE_ERROR' },
      '[internal] Failed to update escrow circuit breaker.'
    );
    return res.status(500).json({ error: 'Failed to update escrow circuit breaker.' });
  }
});

/**
 * @openapi
 * /api/internal/defensive-pause:
 *   post:
 *     tags: [Internal]
 *     summary: Emergency defensive pause (security sentinel)
 *     description: Opens the escrow circuit breaker in response to a detected frontrun/flash-loan pattern. Unlike /pause-escrow this is one-way — it can never close the circuit — so a compromised detector cannot be replayed to re-enable escrow submissions. Closing the circuit stays an operator action via POST /api/internal/pause-escrow {"paused": false}.
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Free-text detector context recorded in the audit log.
 *               txHash:
 *                 type: string
 *                 description: Mempool transaction that triggered the pause.
 *     responses:
 *       200:
 *         description: Circuit breaker opened and persisted
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Failed to persist pause state
 *       503:
 *         description: Redis unavailable — the on-chain pause succeeded, but off-chain persistence failed.
 *       502:
 *         description: Failed to confirm on-chain pause
 */
router.post('/defensive-pause', async (req, res) => {
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 200) : null;
  const txHash = typeof req.body?.txHash === 'string' ? req.body.txHash.slice(0, 100) : null;

  try {
    // Deliberately ignores any `paused` in the body: this endpoint only ever
    // opens the circuit. The sentinel is an automated detector, so giving it a
    // close path would let a single forged call undo an emergency pause.
    const result = await setEscrowPaused(true);
    const onChainResult = await setEscrowContractPaused(true);

    if (onChainResult.error) {
      const redisStatus = result.persisted === false ? 'failed off-chain' : 'processed in Redis';
      return res.status(502).json({
        error: `Defensive pause ${redisStatus}, but on-chain pause failed.`,
        onChainError: onChainResult.error,
        paused: result.paused,
        persisted: result.persisted !== false,
      });
    }

    // Redis was unavailable, so the defensive pause was not persisted. Escrow
    // submissions are still refused (isEscrowPaused() fails closed while Redis
    // is unreadable), but the endpoint must still return 503 — answering 2xx
    // would tell the n8n sentinel the pause succeeded when it did not.
    if (result.persisted === false) {
      logger.error(
        { event: 'DEFENSIVE_PAUSE_NOT_PERSISTED', source: 'security-sentinel', reason, txHash },
        '[internal] Defensive pause failed off-chain. Contract IS paused on-chain, but backend submissions will revert.'
      );
      return res.status(503).json({
        error: 'Defensive pause succeeded on-chain, but Redis is down. Backend submissions will revert.',
        paused: true,
        persisted: false,
        onChain: { success: true, txHash: onChainResult.txHash }
      });
    }

    logger.warn(
      {
        event: 'DEFENSIVE_PAUSE_TRIGGERED',
        source: 'security-sentinel',
        reason,
        txHash,
      },
      '[internal] Defensive pause triggered — escrow circuit breaker opened.'
    );

    return res.json({
      paused: result.paused,
      updatedAt: result.updatedAt,
      persisted: result.persisted !== false,
      source: 'security-sentinel',
      onChain: {
        success: true,
        txHash: onChainResult.txHash,
        alreadyInState: onChainResult.alreadyInState,
      }
    });
  } catch (err) {
    logger.error(
      { err: err && err.message, event: 'DEFENSIVE_PAUSE_ERROR', reason, txHash },
      '[internal] Failed to apply defensive pause.'
    );
    return res.status(500).json({ error: 'Failed to apply defensive pause.' });
  }
});

export default router;
