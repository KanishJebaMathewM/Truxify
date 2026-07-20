import express from 'express';
import rateLimit from 'express-rate-limit';

import { TrackingTokenService } from '../services/trackingTokenService.js';
import { supabase } from '../config/db.js';
import logger from '../middleware/logger.js';
import { createStore, safeIpKeyGenerator } from '../middleware/rateLimiter.js';

const router = express.Router();

const trackingTokenService = new TrackingTokenService({ supabase, logger });

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
  async (req, res) => {
    try {
      const { token } = req.params;

      if (!token || token.length < 10) {
        return res.status(400).json({ error: 'Invalid tracking token' });
      }

      const validation = await trackingTokenService.validateToken(token);

      if (!validation.valid) {
        const statusMessages = {
          not_found: { status: 404, message: 'Tracking link not found or invalid' },
          revoked: { status: 410, message: 'This tracking link has been revoked' },
          expired: { status: 410, message: 'This tracking link has expired' },
        };

        const { status, message } = statusMessages[validation.reason] || statusMessages.not_found;
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
      const publicOrder = {
        order_display_id: order.order_display_id,
        status: order.status,
        pickup_address: order.pickup_address,
        pickup_lat: order.pickup_lat,
        pickup_lng: order.pickup_lng,
        drop_address: order.drop_address,
        drop_lat: order.drop_lat,
        drop_lng: order.drop_lng,
        pickup_date: order.pickup_date,
        pickup_time: order.pickup_time,
        goods_type: order.goods_type,
        weight_tonnes: order.weight_tonnes,
        driver_name: order.driver_name,
        driver_rating: order.driver_rating,
        truck_number: order.truck_number,
        eta: order.eta,
        created_at: order.created_at,
      };

      const publicTimeline = timeline.map((t) => ({
        milestone: t.milestone,
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
  async (req, res) => {
    try {
      const { token } = req.params;

      if (!token || token.length < 10) {
        return res.status(400).json({ error: 'Invalid tracking token' });
      }

      const validation = await trackingTokenService.validateToken(token);

      if (!validation.valid) {
        return res.status(404).json({ error: 'Tracking link not found or invalid' });
      }

      const { orderDisplayId } = validation;

      const { data: order } = await supabase
        .from('orders')
        .select('pickup_lat, pickup_lng, drop_lat, drop_lng, driver_id')
        .eq('order_display_id', orderDisplayId)
        .single();

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      // Return simple pickup-to-drop route for public view
      // Full OSRM route is only available to authenticated users
      const coordinates = [
        [order.pickup_lng, order.pickup_lat],
        [order.drop_lng, order.drop_lat],
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

export default router;
