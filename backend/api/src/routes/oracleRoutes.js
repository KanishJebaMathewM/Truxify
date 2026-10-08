import express from 'express';
import rateLimit from 'express-rate-limit';
import { oracleService } from '../core/container.js';
import { ORACLE_PROVIDER_COUNT, ORACLE_THRESHOLD } from '../oracle/OracleService.js';
import { supabase, createUserClient } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { safeIpKeyGenerator, createStore } from '../middleware/rateLimiter.js';
import { validateBody } from '../middleware/validate.js';
import { oracleConfirmSchema, oracleVerifyCrosschainSchema } from '../validation/requestSchemas.js';
import { PolicyError, policy } from '../security/policyEngine.js';
import logger from '../middleware/logger.js';

const router = express.Router();
const BLOCKCHAIN_TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
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
    const status = oracleService.getStatus();
    res.status(200).json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error({ requestId: req.requestId }, '[OracleRoutes] Status error:', error?.message || error);
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
        error: error?.message ?? String(error)
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

    // Defense in depth: reject malformed transaction hashes before any order
    // lookup or oracle/RPC work. The request schema enforces the same bytes32
    // shape, but this guard keeps the route safe if validation is bypassed or
    // a future schema regression weakens the constraint.
    if (!BLOCKCHAIN_TX_HASH_RE.test(blockchainHash)) {
      return res.status(400).json({
        success: false,
        error: 'blockchainHash must be a 0x-prefixed 32-byte hex string'
      });
    }

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
        error: error?.message ?? String(error)
      });
    }

    logger.error({ requestId: req.requestId }, '[OracleRoutes] Verify-crosschain error:', error?.message || error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error'
    });
  }
});
// Before (using the unprivileged / anon client instance)
async function authorizeOrderAccess(req, res, orderId) {
  const { data: order, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle();

  if (error || !order) {
    return res.status(404).json({ error: 'Order not found.' });
  }
  // ...
}

// After (using the caller's authenticated client or service client)
import { createUserClient } from '../config/db.js'; // or service-role client depending on architecture

async function authorizeOrderAccess(req, res, orderId) {
  // Use the authenticated user client or service client to bypass anon restrictions
  const client = req.token ? createUserClient(req.token) : supabaseAdmin;

  const { data: order, error } = await client
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle();

  if (error || !order) {
    return res.status(404).json({ error: 'Order not found.' });
  }

  // Proceed with RLS/policy checks...
  return order;
}
export default router;
