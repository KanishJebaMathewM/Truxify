import express from 'express';
import { verificationService } from '../core/container.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { validateParams, validateBody } from '../middleware/validate.js';
import { verifyOrderParamsSchema, documentCheckSchema } from '../validation/requestSchemas.js';

const router = express.Router();
const DOCUMENT_REVIEW_ROLES = new Set(['admin', 'regulator']);

function canCheckDriverDocuments(requestUser, driverId) {
  return requestUser?.id === driverId || DOCUMENT_REVIEW_ROLES.has(requestUser?.role);
}

router.get('/order/:orderId', authenticate, validateParams(verifyOrderParamsSchema), async (req, res) => {
  try {
    const { orderId } = req.params;
    const result = await verificationService.verifyOrder(orderId);

    if (result.error && !result.orderId) {
      return res.status(404).json({
        success: false,
        error: result.error,
      });
    }

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

router.post('/documents/check', authenticate, userLimiter, validateBody(documentCheckSchema), async (req, res) => {
  try {
    const { driverId } = req.body;

    if (!canCheckDriverDocuments(req.user, driverId)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied: cannot check documents for another driver.',
      });
    }

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
