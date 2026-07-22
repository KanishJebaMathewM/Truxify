import express from 'express';
import crypto from 'crypto';
import logger from '../middleware/logger.js';
import { dlqService } from '../services/webhook/dlqService.js';

const router = express.Router();

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

/**
 * Verify HMAC-SHA256 signature on incoming webhook requests.
 * Reads the raw body and compares against the X-Webhook-Signature header.
 */
function verifyWebhookSignature(req, res, next) {
  if (!WEBHOOK_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('[Webhook] WEBHOOK_SECRET is not set in production — rejecting request');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }
    logger.warn('[Webhook] WEBHOOK_SECRET not set — skipping signature verification in non-production');
    return next();
  }

  const signature = req.headers['x-webhook-signature'];
  if (!signature) {
    return res.status(401).json({ error: 'Missing X-Webhook-Signature header' });
  }

  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);

  if (sigBuf.length !== expectedBuf.length) {
    logger.warn('[Webhook] Invalid webhook signature length — rejecting request');
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    logger.warn('[Webhook] Invalid webhook signature — rejecting request');
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  next();
}

/**
 * @route POST /api/webhooks/escrow
 * @desc Receive webhook events from Escrow smart contracts
 * @access Webhook Provider (HMAC signature required)
 */
router.post('/escrow', verifyWebhookSignature, async (req, res) => {
  const { eventType, orderId, txHash } = req.body;

  try {
    logger.info(`[Webhook] Received Escrow event: ${eventType} for order ${orderId}`);
    
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
