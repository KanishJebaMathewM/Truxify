import express from 'express';
import rateLimit from 'express-rate-limit';

import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { validateBody } from '../middleware/validate.js';
import { shareTrackingSchema } from '../validation/requestSchemas.js';
import { supabase, redisClient } from '../config/db.js';
import { TrackingTokenService } from '../services/trackingTokenService.js';
import logger from '../middleware/logger.js';
import { createStore, safeIpKeyGenerator } from '../middleware/rateLimiter.js';

const router = express.Router();

const trackingTokenService = new TrackingTokenService({ supabase, logger });

// Rate limiters
const publicTrackingLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: safeIpKeyGenerator,
  store: createStore('rl:public-tracking:'),
});

const shareTrackingLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || 'unknown',
  store: createStore('rl:share-tracking:'),
});

// ──────────────────────────────────────────────────────────────────────────
// POST /api/orders/:id/share-tracking
// Authenticated — generates a shareable tracking link.
// ──────────────────────────────────────────────────────────────────────────
router.post(
  '/:id/share-tracking',
  authenticate,
  shareTrackingLimiter,
  requirePolicy('order:view-active'),
  validateBody(shareTrackingSchema),
  async (req, res) => {
    try {
      const orderDisplayId = req.params.id;
      const userId = req.user.id;

      // Verify the order exists and belongs to the requesting customer
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('order_display_id, customer_id, status')
        .eq('order_display_id', orderDisplayId)
        .single();

      if (orderError || !order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      if (order.customer_id !== userId) {
        return res.status(403).json({ error: 'You can only share tracking for your own orders' });
      }

      // Block sharing for terminal orders
      const terminalStatuses = ['delivered', 'cancelled', 'payment_released'];
      if (terminalStatuses.includes(order.status)) {
        return res.status(400).json({ error: 'Cannot share tracking for completed or cancelled orders' });
      }

      const tokenData = await trackingTokenService.createToken({
        orderDisplayId,
        createdBy: userId,
      });

      // Build the public tracking URL
      const baseUrl = process.env.PUBLIC_TRACKING_URL || `${req.protocol}://${req.get('host')}`;
      const trackingUrl = `${baseUrl}/track/${tokenData.token}`;

      logger.info({ orderDisplayId, userId, tokenId: tokenData.id }, 'Tracking share link generated');

      return res.status(201).json({
        trackingUrl,
        token: tokenData.token,
        expiresAt: tokenData.expires_at,
      });
    } catch (err) {
      logger.error({ err, orderId: req.params.id }, 'Error generating tracking share link');
      return res.status(500).json({ error: 'Failed to generate tracking link' });
    }
  }
);

// ──────────────────────────────────────────────────────────────────────────
// GET /api/orders/:id/share-tracking/revoke
// Authenticated — revokes all active tracking tokens for an order.
// ──────────────────────────────────────────────────────────────────────────
router.post(
  '/:id/share-tracking/revoke',
  authenticate,
  shareTrackingLimiter,
  requirePolicy('order:view-active'),
  async (req, res) => {
    try {
      const orderDisplayId = req.params.id;
      const userId = req.user.id;

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('order_display_id, customer_id')
        .eq('order_display_id', orderDisplayId)
        .single();

      if (orderError || !order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      if (order.customer_id !== userId) {
        return res.status(403).json({ error: 'You can only revoke tracking for your own orders' });
      }

      await trackingTokenService.revokeAllForOrder(orderDisplayId);

      return res.json({ success: true, message: 'All tracking links revoked' });
    } catch (err) {
      logger.error({ err, orderId: req.params.id }, 'Error revoking tracking tokens');
      return res.status(500).json({ error: 'Failed to revoke tracking links' });
    }
  }
);

export default router;
