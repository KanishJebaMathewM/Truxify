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
import { supabase, supabaseAdmin, mongoDb } from '../config/db.js';
import {
  setEscrowPaused,
  getPauseState,
} from '../services/escrowCircuitBreaker.js';
import {
  setEscrowContractPaused,
  pauseEscrowContract,
  submitEscrowRaiseDispute,
  escrowRelease,
} from '../services/escrow.js';

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
 *     description: 'Sets the Redis-backed pause flag that services/escrow.js consults before every on-chain escrow submission. Send {"paused": false} to close the circuit. Closing is operator-only: it additionally requires the dedicated ESCROW_OPERATOR_API_KEY in the same x-api-key header (the key must also be listed in VALID_API_KEYS); any other valid internal key is answered 403, and the unpause fails closed with 403 when ESCROW_OPERATOR_API_KEY is not configured.'
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

router.post('/pause-escrow-onchain', async (_req, res) => {
  try {
    const result = await pauseEscrowContract();
    return res.json(result);
  } catch (err) {
    logger.error(
      { err: err && err.message, event: 'ESCROW_ONCHAIN_PAUSE_ERROR' },
      '[internal] Failed to pause escrow contract on-chain.'
    );
    return res.status(502).json({ error: 'Failed to pause escrow contract on-chain.' });
  }
});

/**
 * @openapi
 * /api/internal/defensive-pause:
 *   post:
 *     tags: [Internal]
 *     summary: Emergency defensive pause (security sentinel)
 *     description: 'Opens the escrow circuit breaker in response to a detected frontrun/flash-loan pattern. Unlike /pause-escrow this is one-way — it can never close the circuit — so a compromised detector cannot be replayed to re-enable escrow submissions. Closing the circuit stays an operator action via POST /api/internal/pause-escrow {"paused": false}.'
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

/**
 * @openapi
 * /api/internal/dispute-evidence/{orderId}:
 *   get:
 *     tags: [Internal]
 *     summary: Retrieve complete dispute evidence package for an unconfirmed or disputed order
 *     security:
 *       - ApiKeyAuth: []
 */
router.get('/dispute-evidence/:orderId', async (req, res) => {
  const { orderId } = req.params;
  if (!orderId) {
    return res.status(400).json({ error: 'orderId parameter is required.' });
  }

  try {
    const client = getDbClient();
    if (!client) {
      return res.status(503).json({ error: 'Database client is not available.' });
    }

    // 1. Fetch Order Metadata
    const { data: order, error: orderErr } = await client
      .from('orders')
      .select('*')
      .or(`id.eq.${orderId},order_display_id.eq.${orderId}`)
      .maybeSingle();

    if (orderErr) {
      logger.error({ err: orderErr.message, orderId }, '[internal] Failed to fetch order for dispute evidence.');
      return res.status(500).json({ error: 'Failed to retrieve order metadata.' });
    }

    if (!order) {
      return res.status(404).json({ error: `Order ${orderId} not found.` });
    }

    // 2. Fetch Driver & Customer Info
    const userIds = [order.customer_id, order.driver_id].filter(Boolean);
    let customer = null;
    let driver = null;

    if (userIds.length > 0) {
      const { data: users, error: userErr } = await client
        .from('users')
        .select('id, full_name, phone, email, role')
        .in('id', userIds);

      if (!userErr && users) {
        customer = users.find(u => u.id === order.customer_id) || null;
        driver = users.find(u => u.id === order.driver_id) || null;
      }
    }

    // 3. Fetch OTP attempt logs
    let otpLogs = [];
    try {
      const { data: otps, error: otpErr } = await client
        .from('delivery_otps')
        .select('*')
        .or(`order_id.eq.${order.id},order_id.eq.${order.order_display_id || order.id}`)
        .order('created_at', { ascending: false });

      if (!otpErr && otps) {
        otpLogs = otps;
      }
    } catch (err) {
      logger.warn({ err: err.message, orderId }, '[internal] Failed to fetch delivery OTP logs.');
    }

    // 4. Fetch GPS Trail from MongoDB telemetry
    let gpsTrail = [];
    if (mongoDb) {
      try {
        const telemetryCol = mongoDb.collection('telemetry');
        gpsTrail = await telemetryCol
          .find({
            $or: [
              { order_id: order.id },
              { order_id: order.order_display_id },
              { orderId: order.id },
              { bookingId: order.order_display_id },
              { driver_id: order.driver_id },
            ]
          })
          .sort({ timestamp: 1 })
          .limit(200)
          .toArray();
      } catch (mErr) {
        logger.warn({ err: mErr.message }, '[internal] Failed to read MongoDB telemetry for dispute evidence.');
      }
    }

    // 5. Geofence Validation Data
    const geofenceValidation = {
      verified: Boolean(order.geofence_verified || order.drop_geofence_verified),
      dropLocation: order.drop_location || null,
      deliveryCoordinates: order.delivery_coordinates || null,
      geofenceRadiusMeters: order.geofence_radius || 150,
      validatedAt: order.geofence_verified_at || order.delivered_at || null,
    };

    return res.json({
      orderId: order.id,
      bookingId: order.order_display_id || order.id,
      status: order.status,
      escrowStatus: order.escrow_status,
      evidence: {
        gpsTrail,
        otpLogs,
        deliveryTimestamp: order.delivered_at || order.updated_at || null,
        geofenceValidation,
        driver: driver ? {
          id: driver.id,
          name: driver.full_name,
          phone: driver.phone,
          email: driver.email,
        } : null,
        customer: customer ? {
          id: customer.id,
          name: customer.full_name,
          phone: customer.phone,
          email: customer.email,
        } : null,
        orderMetadata: {
          id: order.id,
          orderDisplayId: order.order_display_id,
          pickupLocation: order.pickup_location,
          dropLocation: order.drop_location,
          totalAmount: order.total_amount,
          status: order.status,
          escrowStatus: order.escrow_status,
          createdAt: order.created_at,
          deliveredAt: order.delivered_at,
          updatedAt: order.updated_at,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err: err.message, orderId }, '[internal] Error generating dispute evidence package.');
    return res.status(500).json({ error: 'Failed to generate dispute evidence package.' });
  }
});

/**
 * @openapi
 * /api/internal/training-readiness:
 *   get:
 *     tags: [Internal]
 *     summary: Check data readiness for ML model retraining
 *     security:
 *       - ApiKeyAuth: []
 */
router.get('/training-readiness', async (req, res) => {
  try {
    const client = getDbClient();
    if (!client) {
      return res.status(503).json({ error: 'Database is not configured.' });
    }

    const sinceParam = req.query.since;
    const cutoffDate = sinceParam
      ? new Date(sinceParam).toISOString()
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Query completed orders since cutoff
    const { count: completedOrdersCount, error: ordersErr } = await client
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .in('status', ['delivered', 'completed'])
      .gte('updated_at', cutoffDate);

    if (ordersErr) {
      logger.error({ err: ordersErr.message }, '[internal] Failed to query completed orders for training readiness.');
      return res.status(502).json({ error: 'Failed to query completed orders count.' });
    }

    // Query MongoDB telemetry statistics
    let telemetryCount = 0;
    if (mongoDb) {
      try {
        telemetryCount = await mongoDb.collection('telemetry').countDocuments({
          timestamp: { $gte: new Date(cutoffDate) }
        });
      } catch (mErr) {
        telemetryCount = await mongoDb.collection('telemetry').estimatedDocumentCount().catch(() => 0);
      }
    }

    const count = completedOrdersCount || 0;
    const minThreshold = 100;
    const isReady = count >= minThreshold;

    return res.json({
      ready: isReady,
      completedOrdersCount: count,
      minOrdersRequired: minThreshold,
      telemetryRecordsCount: telemetryCount,
      since: cutoffDate,
      reason: isReady
        ? `Data readiness criteria met: ${count} completed orders (>= ${minThreshold}).`
        : `Insufficient completed orders: ${count} < ${minThreshold}. Retraining skipped.`,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err: err.message }, '[internal] Training readiness evaluation failed.');
    return res.status(500).json({ error: 'Failed to evaluate training readiness.' });
  }
});

/**
 * @openapi
 * /api/internal/escrow/freeze:
 *   post:
 *     tags: [Internal]
 *     summary: Freeze escrow payment for a disputed booking
 *     security:
 *       - ApiKeyAuth: []
 */
router.post('/escrow/freeze', async (req, res) => {
  const bookingId = req.body?.bookingId || req.body?.orderId;
  if (!bookingId) {
    return res.status(400).json({ error: 'bookingId is required.' });
  }

  try {
    const result = await submitEscrowRaiseDispute(bookingId);

    if (supabaseAdmin) {
      await supabaseAdmin
        .from('orders')
        .update({
          escrow_status: 'disputed',
          status: 'disputed',
          updated_at: new Date().toISOString(),
        })
        .or(`id.eq.${bookingId},order_display_id.eq.${bookingId}`);
    }

    return res.json({
      success: true,
      message: 'Escrow payment frozen for dispute.',
      bookingId,
      txHash: result.txHash,
      alreadyInState: result.alreadyInState || false,
    });
  } catch (err) {
    logger.error({ err: err.message, bookingId }, '[internal] Escrow freeze failed.');
    return res.status(500).json({ error: 'Failed to freeze escrow payment.', details: err.message });
  }
});

/**
 * @openapi
 * /api/internal/escrow/release:
 *   post:
 *     tags: [Internal]
 *     summary: Release escrow payment upon dispute resolution
 *     security:
 *       - ApiKeyAuth: []
 */
router.post('/escrow/release', async (req, res) => {
  const bookingId = req.body?.bookingId || req.body?.orderId;
  if (!bookingId) {
    return res.status(400).json({ error: 'bookingId is required.' });
  }

  try {
    const result = await escrowRelease(bookingId);

    if (supabaseAdmin) {
      await supabaseAdmin
        .from('orders')
        .update({
          escrow_status: 'released',
          escrow_released_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .or(`id.eq.${bookingId},order_display_id.eq.${bookingId}`);
    }

    return res.json({
      success: true,
      message: 'Escrow payment released successfully.',
      bookingId,
      txHash: result.txHash,
      alreadyReleased: result.alreadyReleased || false,
    });
  } catch (err) {
    logger.error({ err: err.message, bookingId }, '[internal] Escrow release failed.');
    return res.status(500).json({ error: 'Failed to release escrow payment.', details: err.message });
  }
});

export default router;
