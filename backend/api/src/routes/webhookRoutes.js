import express from 'express';
import crypto from 'crypto';
import logger from '../middleware/logger.js';
import { redisClient } from '../config/db.js';
import { dlqService } from '../services/webhook/dlqService.js';
import { processEscrowWebhookEvent } from '../services/webhook/escrowWebhookProcessor.js';

const router = express.Router();

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

// Replay defense: reject webhooks whose timestamp is outside this window. The
// nonce is stored for a TTL that is at least as long as this window so a
// captured-but-expired request is always caught by the nonce store.
const ESCROW_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes
const ESCROW_NONCE_TTL_SECONDS = 10 * 60; // 10 minutes (> tolerance window)

// In-memory fallback for consumed nonces when Redis is unavailable. Maps
// nonce -> absolute expiry (ms epoch); pruned lazily on each lookup.
const seenNonces = new Map();
const MAX_SEEN_NONCES = 10000;

function pruneSeenNonces(now) {
  if (seenNonces.size <= MAX_SEEN_NONCES) return;
  for (const [nonce, expiry] of seenNonces) {
    if (expiry <= now) seenNonces.delete(nonce);
  }
}

/**
 * Reject replayed nonces. Returns true if the nonce was already consumed.
 * Uses Redis (SET NX EX) when available so the check is shared across
 * instances; otherwise falls back to an in-memory store.
 */
async function isNonceReplayed(nonce) {
  const now = Date.now();

  if (redisClient) {
    try {
      const key = `escrow_webhook_nonce:${nonce}`;
      // SET NX EX returns 'OK' only on first insertion; an existing key means
      // the nonce was already seen within its TTL -> replay.
      const result = await redisClient.set(key, '1', 'NX', 'EX', ESCROW_NONCE_TTL_SECONDS);
      return result !== 'OK';
    } catch (err) {
      logger.error(`[Webhook] Redis nonce check failed: ${err.message}`);
      // Fail closed: if we cannot verify the nonce we must not accept the event.
      throw new Error('Unable to verify webhook nonce', { cause: err });
    }
  }

  pruneSeenNonces(now);
  if (seenNonces.has(nonce)) return true;
  seenNonces.set(nonce, now + ESCROW_NONCE_TTL_SECONDS * 1000);
  return false;
}

/**
 * Verify HMAC-SHA256 signature on incoming webhook requests, then enforce
 * timestamp/nonce replay protection. Reads the raw body and compares against
 * the X-Webhook-Signature header.
 */
async function verifyWebhookSignature(req, res, next) {
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

  // ---- Replay defense (after authentication) ----
  const timestampHeader = req.headers['x-escrow-timestamp'];
  const nonce = req.headers['x-escrow-nonce'];

  if (!timestampHeader || !nonce) {
    logger.warn('[Webhook] Missing x-escrow-timestamp or x-escrow-nonce header — rejecting request');
    return res.status(401).json({ error: 'Missing replay-protection headers' });
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp) || !Number.isInteger(timestamp)) {
    logger.warn('[Webhook] Invalid x-escrow-timestamp header — rejecting request');
    return res.status(401).json({ error: 'Invalid x-escrow-timestamp header' });
  }

  const nowMs = Date.now();
  const skew = Math.abs(nowMs - timestamp);
  if (skew > ESCROW_TIMESTAMP_TOLERANCE_MS) {
    logger.warn(`[Webhook] x-escrow-timestamp outside tolerance (skew ${skew}ms) — rejecting request`);
    return res.status(401).json({ error: 'Webhook timestamp outside accepted window' });
  }

  try {
    if (await isNonceReplayed(nonce)) {
      logger.warn(`[Webhook] Replayed nonce ${nonce} — rejecting request`);
      return res.status(401).json({ error: 'Webhook nonce already used (replay)' });
    }
  } catch (err) {
    logger.error(`[Webhook] Nonce verification failed: ${err.message}`);
    return res.status(503).json({ error: 'Unable to verify webhook nonce' });
  }

  next();
}

/**
 * Build a caller-safe error description for webhook clients.
 *
 * Internal failure details (raw provider/RPC errors, database errors, stack
 * traces, contract internals, secrets) are NEVER echoed back to the webhook
 * provider. Permanent failures carry a stable error code so operators can
 * correlate; transient failures are described generically since they are
 * retried by the DLQ.
 */
function safeWebhookError(orderId, error) {
  const prefix = `Webhook processing failed for order ${orderId}`;
  const code = error && typeof error === 'object' && typeof error.code === 'string'
    ? error.code
    : null;
  return code ? `${prefix} (${code})` : prefix;
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
    // Full detail goes to server logs / DLQ for operator triage only.
    logger.error(
      { webhookEventType: eventType, orderId, errorCode: error?.code || null },
      `[Webhook] Failed to process escrow webhook for order ${orderId}: ${error.message}`,
    );

    // Enqueue to Dead Letter Queue for background retries
    const enqueued = await dlqService.enqueueFailure('escrow', eventType, req.body, error);

    // Fail closed: if the event cannot be persisted to the DLQ, return 500 so
    // the provider retries. Returning 202 would silently drop the event forever.
    if (!enqueued) {
      return res.status(500).json({
        error: 'Webhook processing failed and the event could not be queued for retry',
      });
    }

    // Return 202 Accepted so the provider stops retrying - we now own the retry logic via our DLQ.
    // Non-retryable failures are dead-lettered immediately (failed_permanently).
    const permanent = error && typeof error === 'object' && error.retryable === false;
    return res.status(202).json({
      received: true,
      status: permanent ? 'dead_lettered' : 'queued_for_retry',
      error: safeWebhookError(orderId, error),
    });
  }
});

export default router;
