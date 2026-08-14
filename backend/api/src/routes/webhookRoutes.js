import express from 'express';
import crypto from 'crypto';
import logger from '../middleware/logger.js';
import { dlqService } from '../services/webhook/dlqService.js';
import { processEscrowWebhookEvent } from '../services/webhook/escrowWebhookProcessor.js';

const router = express.Router();

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

/**
 * Verify HMAC-SHA256 signature on incoming webhook requests.
 * Reads the raw body and compares against the X-Webhook-Signature header.
 */
function verifyWebhookSignature(req, res, next) {
  if (!WEBHOOK_SECRET) {
    // Fail closed: never accept unsigned webhook traffic when the shared
    // secret is missing from the environment.
    logger.error('[Webhook] WEBHOOK_SECRET not set — rejecting webhook request');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  const signature = req.headers['x-webhook-signature'];
  if (!signature) {
    return res.status(401).json({ error: 'Missing X-Webhook-Signature header' });
  }

  const rawBody = req.rawBody;
  if (!rawBody) {
    logger.error('[Webhook] rawBody missing — cannot verify signature, rejecting request');
    return res.status(500).json({ error: 'Internal Server Error' });
  }

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
    await processEscrowWebhookEvent(eventType, req.body);
    return res.status(200).json({ received: true });
  } catch (error) {
    logger.error(`[Webhook] Failed to process escrow webhook for order ${orderId}: ${error.message}`);

    // Enqueue to Dead Letter Queue for background retries
    const enqueued = await dlqService.enqueueFailure('escrow', eventType, req.body, error);

    // Fail closed: if the event cannot be persisted to the DLQ, return 500 so
    // the provider retries. Returning 202 would silently drop the event forever.
    if (!enqueued) {
      return res.status(500).json({
        error: 'Webhook processing failed and the event could not be queued for retry',
      });
    }

    // Return 202 Accepted so the provider stops retrying - we now own the retry logic via our DLQ
    return res.status(202).json({
      received: true,
      status: 'queued_for_retry',
      error: `Webhook processing failed for order ${orderId}: ${error?.message || 'Unknown error'}`,
    });
  }
});

export default router;
