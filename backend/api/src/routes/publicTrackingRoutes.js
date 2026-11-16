// backend/api/src/routes/publicTrackingRoutes.js
import express from 'express';
import { TrackingTokenService } from '../services/trackingTokenService.js';
import { supabaseAdmin, supabase } from '../config/db.js';
import logger from '../middleware/logger.js';
import { validateParams } from '../middleware/validate.js';
import rateLimit from 'express-rate-limit';
import { createStore, safeIpKeyGenerator } from '../middleware/rateLimiter.js';
import GpsLog from '../models/GpsLog.js';
import { publicTrackingTokenSchema } from '../validation/requestSchemas.js';
import { trackingTokenInvalidResponse } from '../utils/trackingTokenStatus.js';

const router = express.Router();

// Parse a finite coordinate or return null (missing/NaN/out-of-range).
function parseFiniteCoordinate(value) {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  if (Math.abs(n) > 180) return null;
  return n;
}

// HTML-encode user-controlled strings before serving them on public
// (unauthenticated) tracking pages — issue #14364 XSS guard.
function encodeHtml(value) {
  if (value === null || value === undefined) return value;
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Public unauthenticated tracking links — a dedicated limiter (the shared
// publicTrackingLimiter lands with #17627; defined locally here so this file
// stands alone).
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: safeIpKeyGenerator,
  validate: { keyGeneratorIpFallback: false },
  store: createStore('rl:public-tracking:'),
  message: { error: 'Rate limit exceeded', retryAfter: 900 },
});

// 🔒 CRITICAL FIX (#10131 / #8954): Public tracking share-links are unauthenticated.
// Passing supabaseAdmin ensures RLS-protected tables (tracking_tokens, orders, order_timeline)
// can be queried successfully without returning 0 rows (404).
const trackingTokenService = new TrackingTokenService({
  supabase: supabaseAdmin, // Use service-role client for public unauthenticated lookups
  supabaseAdmin,
  logger,
});

// ──────────────────────────────────────────────────────────────────────────
// GET /api/public/tracking/:token
// Public — no authentication required. Returns safe order subset.
// ──────────────────────────────────────────────────────────────────────────
router.get(
  '/tracking/:token',
  publicLimiter,
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

      // Fetch order, timeline, and driver location in parallel
      const [order, timeline, driverLocation] = await Promise.all([
        trackingTokenService.getOrderForPublicTracking(orderDisplayId),
        trackingTokenService.getOrderTimeline(orderDisplayId),
        trackingTokenService.getDriverLocation(orderDisplayId),
      ]);

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      // Expose ONLY safe public fields — sensitive data is never included
      // All string fields are HTML-encoded to prevent XSS (issue #14364)
      const publicOrder = {
        order_display_id: encodeHtml(order.order_display_id),
        status: encodeHtml(order.status),
        pickup_address: encodeHtml(order.pickup_address),
        pickup_lat: order.pickup_lat,
        pickup_lng: order.pickup_lng,
        drop_address: encodeHtml(order.drop_address),
        drop_lat: order.drop_lat,
        drop_lng: order.drop_lng,
        pickup_date: encodeHtml(order.pickup_date),
        pickup_time: encodeHtml(order.pickup_time),
        goods_type: encodeHtml(order.goods_type),
        weight_tonnes: order.weight_tonnes,
        driver_name: encodeHtml(order.driver_name),
        driver_rating: order.driver_rating,
        truck_number: encodeHtml(order.truck_number),
        eta: encodeHtml(order.eta),
        created_at: order.created_at,
      };

      const publicTimeline = timeline.map((t) => ({
        milestone: encodeHtml(t.milestone),
        milestone_time: t.milestone_time,
        completed: t.completed,
        sort_order: t.sort_order,
      }));

      const publicDriverLocation = driverLocation
        ? {
            latitude: driverLocation.latitude,
            longitude: driverLocation.longitude,
            last_updated_at: driverLocation.last_updated_at,
          }
        : null;

      // Success — only the vetted public fields, HTML-encoded (issue #14364).
      return res.json({
        order: publicOrder,
        timeline: publicTimeline,
        driver_location: publicDriverLocation,
      });
    } catch (err) {
      logger.error({ err }, 'Public tracking fetch failed');
      return res.status(500).json({ error: 'Failed to load tracking details' });
    }
  }
);

// ──────────────────────────────────────────────────────────────────────────
// GET /api/public/tracking/:token/route
// Public — returns route geometry for the tracked order.
// ──────────────────────────────────────────────────────────────────────────
router.get(
  '/tracking/:token/route',
  publicLimiter,
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

      if ([pickupLat, pickupLng, dropLat, dropLng].some((v) => v === null)) {
        return res.status(422).json({ error: 'Route coordinates are not available for this order' });
      }

      // Straight-line fallback geometry between the vetted endpoints.
      return res.json({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [pickupLng, pickupLat],
            [dropLng, dropLat],
          ],
        },
        properties: { fallback: true },
      });
    } catch (error) {
      logger.error({ err: error }, 'Error processing public tracking request');
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
