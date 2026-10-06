// backend/api/src/routes/publicTrackingRoutes.js
import express from 'express';
import { TrackingTokenService } from '../services/trackingTokenService.js';
import { supabaseAdmin, supabase } from '../config/db.js';
import logger from '../middleware/logger.js';
import { validateParams } from '../middleware/validate.js';
import { createStore, safeIpKeyGenerator, publicTrackingLimiter } from '../middleware/rateLimiter.js';
import GpsLog from '../models/GpsLog.js';
import { publicTrackingTokenSchema } from '../validation/requestSchemas.js';
import { trackingTokenInvalidResponse } from '../utils/trackingTokenStatus.js';

const router = express.Router();

// 🔒 CRITICAL FIX (#10131 / #8954): Public tracking share-links are unauthenticated.
// Passing supabaseAdmin ensures RLS-protected tables (tracking_tokens, orders, order_timeline)
// can be queried successfully without returning 0 rows (404).
const trackingTokenService = new TrackingTokenService({
  supabase: supabaseAdmin, // Use service-role client for public unauthenticated lookups
  supabaseAdmin,
  logger,
});

// ──────────────────────────────────────────────────────────────────────────
// GET /api/public/tracking/:token/route
// Public — returns route geometry for the tracked order.
// ──────────────────────────────────────────────────────────────────────────
router.get(
  '/tracking/:token/route',
  publicTrackingLimiter,
  validateParams(publicTrackingTokenSchema),
  async (req, res) => {
    try {
      const { token } = req.params;

      const validation = await trackingTokenService.validateToken(token);

      if (validation.reason === 'validation_error') {
        return res.status(400).json({ error: 'Invalid tracking token' });
      }

      if (!validation.valid) {
        const { status, message } = trackingTokenInvalidResponse(validation);
        return res.status(status).json({ error: message });
      }

      const { orderDisplayId } = validation;

      // Read via the service-role client (TrackingTokenService uses
      // supabaseAdmin). The anon `supabase` client cannot read `orders`
      // (no anon RLS policy; anon privileges revoked) → previously every
      // request 404'd even with a valid token (issue #13906).
      const order = await trackingTokenService.getOrderRouteCoords(orderDisplayId);

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      const pickupLat = parseFiniteCoordinate(order.pickup_lat);
      const pickupLng = parseFiniteCoordinate(order.pickup_lng);
      const dropLat = parseFiniteCoordinate(order.drop_lat);
      const dropLng = parseFiniteCoordinate(order.drop_lng);

    return res.json(result.data);
  } catch (error) {
    logger.error({ err: error }, 'Error processing public tracking request');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
