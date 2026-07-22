import express from 'express';
import { oracleService } from '../core/container.js';
import { authenticate } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { oracleConfirmSchema, oracleVerifyCrosschainSchema } from '../validation/requestSchemas.js';

const router = express.Router();

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

router.post('/confirm', authenticate, validateBody(oracleConfirmSchema), async (req, res) => {
  try {
    const { orderId, otp, gpsCoordinates } = req.body;
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
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/verify-crosschain', authenticate, validateBody(oracleVerifyCrosschainSchema), async (req, res) => {
  try {
    const { orderId, blockchainHash } = req.body;
    const result = await oracleService.verifyCrossChain(orderId, blockchainHash);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
