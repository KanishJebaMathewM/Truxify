import express from 'express';
import rateLimit from 'express-rate-limit';
import { oracleService } from '../core/container.js';
import { supabase, createUserClient, redisClient } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { requireApiKey } from '../middleware/apiKey.js';
import { safeIpKeyGenerator, createStore } from '../middleware/rateLimiter.js';
import { validateBody } from '../middleware/validate.js';
import { oracleConfirmSchema, oracleVerifyCrosschainSchema, oracleGasPriceSyncSchema } from '../validation/requestSchemas.js';
import { PolicyError, policy } from '../security/policyEngine.js';
import logger from '../middleware/logger.js';

const router = express.Router();
const oracleVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: safeIpKeyGenerator,
  validate: { keyGeneratorIpFallback: false },
  store: createStore('rl:oracle-verification:'),
  message: { error: 'Rate limit exceeded', retryAfter: 900 },
});

// Gas-price feed persistence keys used by POST /gas-price (n8n oracle_sync).
const GAS_PRICE_KEY = 'oracle:gas-price:polygon-gwei';
const GAS_PRICE_IDEMPOTENCY_KEY = 'oracle:gas-price:last-idempotency-key';
const GAS_PRICE_TTL_SECONDS = 7 * 24 * 60 * 60;
const IDEMPOTENCY_TTL_SECONDS = 60 * 60;

async function authorizeOrderAccess(req, orderId) {
  const client = req.token ? createUserClient(req.token) : supabase;
  const { data: order, error } = await client
    .from('orders')
    .select('id, customer_id, driver_id')
    .eq('id', orderId)
    .maybeSingle();

  if (error) {
    const err = new Error('Failed to verify order access');
    err.status = 500;
    throw err;
  }

  if (!order) {
    const err = new Error('Order not found');
    err.status = 404;
    throw err;
  }

  policy.authorize(req.user, 'order:view', { order });
}

router.get('/status', authenticate, async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: {
        providers: 3,
        threshold: 2,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error({ requestId: req.requestId }, '[OracleRoutes] Status error:', error?.message || error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error'
    });
  }
});

router.post('/gas-price', oracleVerificationLimiter, requireApiKey, validateBody(oracleGasPriceSyncSchema), async (req, res) => {
  try {
    const { gasGwei, idempotencyKey, timestamp } = req.body;

    // Idempotent sync: the n8n oracle_sync workflow keys each 5-minute window
    // with gas_sync_<window>, so a replayed window must not be persisted twice.
    if (redisClient) {
      try {
        const lastKey = await redisClient.get(GAS_PRICE_IDEMPOTENCY_KEY);
        if (lastKey === idempotencyKey) {
          logger.info(`[oracle] Gas price sync ${idempotencyKey} already processed — skipping.`);
          return res.json({ success: true, deduplicated: true, gasGwei, idempotencyKey });
        }
      } catch (err) {
        logger.warn(`[oracle] Failed to read gas-price idempotency key: ${err.message}`);
      }
    }

    if (redisClient) {
      await redisClient.set(GAS_PRICE_KEY, String(gasGwei), 'EX', GAS_PRICE_TTL_SECONDS);
      await redisClient.set(GAS_PRICE_IDEMPOTENCY_KEY, idempotencyKey, 'EX', IDEMPOTENCY_TTL_SECONDS);
      logger.info(`[oracle] Persisted Polygon gas price: ${gasGwei} gwei (key ${idempotencyKey}).`);
    } else {
      logger.warn('[oracle] Redis unavailable — gas price not persisted.');
    }

    return res.json({
      success: true,
      deduplicated: false,
      gasGwei,
      idempotencyKey,
      timestamp: timestamp || Date.now(),
    });
  } catch (err) {
    logger.error({ requestId: req.requestId }, '[OracleRoutes] Gas-price sync error:', err?.message || err);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error'
    });
  }
});

router.post('/confirm', oracleVerificationLimiter, authenticate, validateBody(oracleConfirmSchema), async (req, res) => {
  try {
    const { orderId, otp, gpsCoordinates } = req.body;
    await authorizeOrderAccess(req, orderId);

    const result = await oracleService.confirmDelivery({
      orderId,
      otp,
      gpsCoordinates
    });

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    if (error instanceof PolicyError || error.status) {
      return res.status(error.status || 403).json({
        success: false,
        error: error.message
      });
    }

    logger.error({ requestId: req.requestId }, '[OracleRoutes] Confirm error:', error?.message || error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error'
    });
  }
});

router.post('/verify-crosschain', oracleVerificationLimiter, authenticate, validateBody(oracleVerifyCrosschainSchema), async (req, res) => {
  try {
    const { orderId, blockchainHash } = req.body;
    await authorizeOrderAccess(req, orderId);

    const result = await oracleService.verifyCrossChain(orderId, blockchainHash);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    if (error instanceof PolicyError || error.status) {
      return res.status(error.status || 403).json({
        success: false,
        error: error.message
      });
    }

    logger.error({ requestId: req.requestId }, '[OracleRoutes] Verify-crosschain error:', error?.message || error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error'
    });
  }
});

export default router;
