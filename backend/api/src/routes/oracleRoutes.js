import express from 'express';
import { oracleService } from '../core/container.js';
import { supabase } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { validateBody } from '../middleware/validate.js';
import { oracleConfirmSchema, oracleVerifyCrosschainSchema } from '../validation/requestSchemas.js';
import { PolicyError, policy } from '../security/policyEngine.js';

const router = express.Router();

async function authorizeOrderAccess(req, orderId) {
  const { data: order, error } = await supabase
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
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/confirm', authenticate, userLimiter, validateBody(oracleConfirmSchema), async (req, res) => {
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

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/verify-crosschain', authenticate, userLimiter, validateBody(oracleVerifyCrosschainSchema), async (req, res) => {
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

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
