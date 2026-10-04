import express from 'express';
import rateLimit from 'express-rate-limit';

import { TrackingTokenService } from '../services/trackingTokenService.js';
import { supabase, supabaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';
import { validateParams } from '../middleware/validate.js';
import { createStore, safeIpKeyGenerator } from '../middleware/rateLimiter.js';
import GpsLog from '../models/GpsLog.js';
import { publicTrackingTokenSchema } from '../validation/requestSchemas.js';
import { trackingTokenInvalidResponse } from '../utils/trackingTokenStatus.js';

const router = express.Router();

const trackingTokenService = new TrackingTokenService({ supabase, supabaseAdmin, logger });

// Encode strings to prevent XSS when rendered in HTML contexts
function encodeHtml(str) {
  if (str == null) return str;
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function parseFiniteCoordinate(value) {
  if (value === null || value === undefined || value === '') return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseHistoryQuery(query) {
  const limit = query.limit === undefined ? 100 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) return null;

  const filter = {};
  if (query.from !== undefined) {
    const from = new Date(query.from);
    if (Number.isNaN(from.getTime())) return null;
    filter.timestamp = { ...filter.timestamp, $gte: from };
  }
  if (query.to !== undefined) {
    const to = new Date(query.to);
    if (Number.isNaN(to.getTime())) return null;
    filter.timestamp = { ...filter.timestamp, $lte: to };
  }

  return { limit, filter };
}

// Rate limiter — generous for public consumers, strict per IP
const publicLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: safeIpKeyGenerator,
  store: createStore('rl:public-track:'),
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

      return res.json({
        order: publicOrder,
        timeline: publicTimeline,
        driver_location: publicDriverLocation,
      });
    } catch (err) {
      logger.error({ err }, 'Error fetching public tracking data');
      return res.status(500).json({ error: 'Failed to load tracking information' });
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

      if ([pickupLat, pickupLng, dropLat, dropLng].some((value) => value === null)) {
        return res.status(422).json({ error: 'Route coordinates are not available for this order' });
      }

      // Return simple pickup-to-drop route for public view
      // Full OSRM route is only available to authenticated users
      const coordinates = [
        [pickupLng, pickupLat],
        [dropLng, dropLat],
      ];

      return res.json({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates,
        },
        properties: { fallback: true },
      });
    } catch (err) {
      logger.error({ err }, 'Error fetching public route data');
      return res.status(500).json({ error: 'Failed to load route information' });
    }
  }
);

// ──────────────────────────────────────────────────────────────────────────
// GET /api/public/tracking/:token/history
// Public — returns bounded GPS history for a valid tracking link.
// ──────────────────────────────────────────────────────────────────────────
router.get(
  '/tracking/:token/history',
  publicLimiter,
  validateParams(publicTrackingTokenSchema),
  async (req, res) => {
    try {
      const query = parseHistoryQuery(req.query);
      if (!query) {
        return res.status(422).json({ error: 'limit must be 1-500 and from/to must be valid dates' });
      }

      const validation = await trackingTokenService.validateToken(req.params.token);
      if (validation.reason === 'validation_error') {
        return res.status(400).json({ error: 'Invalid tracking token' });
      }
      if (!validation.valid) {
        const statusMessages = {
          not_found: { status: 404, message: 'Tracking link not found or invalid' },
          revoked: { status: 410, message: 'This tracking link has been revoked' },
          expired: { status: 410, message: 'This tracking link has expired' },
        };
        const { status, message } = statusMessages[validation.reason] || statusMessages.not_found;
        return res.status(status).json({ error: message });
      }

      const logs = await GpsLog.find({ bookingId: validation.orderDisplayId, ...query.filter })
        .sort({ timestamp: -1 })
        .limit(query.limit)
        .lean();

      return res.json({
        points: logs.map((log) => ({
          latitude: log.lat,
          longitude: log.lng,
          speed: log.speed,
          heading: log.heading,
          timestamp: log.timestamp,
        })),
        count: logs.length,
        limit: query.limit,
      });
    } catch (err) {
      logger.error({ err }, 'Error fetching public tracking history');
      return res.status(500).json({ error: 'Failed to load tracking history' });
    }
  }
);

export default router;
