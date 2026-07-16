import express from 'express';
import logger from '../middleware/logger.js';
import { dlqService } from '../services/webhook/dlqService.js';

const router = express.Router();

/**
 * @route POST /api/webhooks/escrow
 * @desc Receive webhook events from Escrow smart contracts
 * @access Public (Webhook Provider)
 */
router.post('/escrow', async (req, res) => {
  const { eventType, orderId, txHash } = req.body;

  try {
    logger.info(`[Webhook] Received Escrow event: ${eventType} for order ${orderId}`);

    // In a real scenario, we would verify a signature or API key here
    
    // Simulate some processing that might fail
    if (req.body.simulateFailure === true) {
      throw new Error('Simulated database lock or processing failure');
    }

    // Processing success
    return res.status(200).json({ received: true });
  } catch (error) {
    logger.error(`[Webhook] Failed to process escrow webhook for order ${orderId}: ${error.message}`);
    
    // Enqueue to Dead Letter Queue for background retries
    await dlqService.enqueueFailure('escrow', eventType, req.body, error);

    // Return 202 Accepted so the provider stops retrying - we now own the retry logic via our DLQ
    return res.status(202).json({ 
      received: true, 
      status: 'queued_for_retry'
    });
  }
});

export default router;
