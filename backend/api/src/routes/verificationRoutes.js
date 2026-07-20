import express from 'express';
import VerificationService from '../services/verification/VerificationService.js';
import { authenticate } from '../middleware/auth.js';
import { validateParams, validateBody } from '../middleware/validate.js';
import { verifyOrderParamsSchema, documentCheckSchema } from '../validation/requestSchemas.js';

const router = express.Router();
const verificationService = new VerificationService();

// Verification endpoint for orders
router.get('/order/:orderId', authenticate, validateParams(verifyOrderParamsSchema), async (req, res) => {
  try {
    const { orderId } = req.params;
    const result = await verificationService.verifyOrder(orderId);
    
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

// Document integrity check
router.post('/documents/check', authenticate, validateBody(documentCheckSchema), async (req, res) => {
  try {
    const { driverId } = req.body;
    const result = await verificationService.checkDocumentIntegrity(driverId);
    
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
