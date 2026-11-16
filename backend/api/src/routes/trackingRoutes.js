import express from 'express';
import rateLimit from 'express-rate-limit';

import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { validateBody } from '../middleware/validate.js';
import { shareTrackingSchema } from '../validation/requestSchemas.js';
import { createUserClient, supabaseAdmin } from '../config/db.js';
import { TrackingTokenService } from '../services/trackingTokenService.js';
import logger from '../middleware/logger.js';
import { createStore, safeIpKeyGenerator } from '../middleware/rateLimiter.js';

const router = express.Router();

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

      // Run reads/writes through the caller's user-scoped client. orders has no
      // anon RLS policy (and anon privileges are revoked), so the shared anon
      // client could never return the row and every request 404'd.
      const userClient = createUserClient(req.token);
      const tokenService = new TrackingTokenService({ supabase: userClient, logger });

      // Verify the order exists and belongs to the requesting customer
      const { data: order, error: orderError } = await userClient
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

      // Validate configuration before touching existing links. Previously the
      // old link was revoked first, so a missing PUBLIC_TRACKING_URL left the
      // customer with no working link at all.
      const baseUrl = process.env.PUBLIC_TRACKING_URL;
      if (!baseUrl) {
        logger.error({ orderDisplayId }, 'PUBLIC_TRACKING_URL is not configured');
        return res.status(503).json({ error: 'Tracking links are temporarily unavailable' });
      }

      // Capture the old links, create the replacement, then revoke only the old
      // IDs. Revoking before creation destroyed the only link when the insert
      // failed, and a blanket revoke after creation would revoke the new token.
      let previousTokens = [];
      try {
        previousTokens = await tokenService.getActiveTokensForOrder(orderDisplayId);
      } catch (err) {
        logger.warn({ err, orderDisplayId }, 'Could not list existing tracking tokens');
      }

      const tokenData = await tokenService.createToken({
        orderDisplayId,
        createdBy: userId,
      });

      for (const previous of previousTokens) {
        try {
          await tokenService.revokeToken(previous.id);
        } catch (err) {
          logger.warn({ err, orderDisplayId, tokenId: previous.id }, 'Could not revoke previous tracking token');
        }
      }

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

      const userClient = createUserClient(req.token);
      const tokenService = new TrackingTokenService({ supabase: userClient, logger });

      const { data: order, error: orderError } = await userClient
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

      await tokenService.revokeAllForOrder(orderDisplayId);

      return res.json({ success: true, message: 'All tracking links revoked' });
    } catch (err) {
      logger.error({ err, orderId: req.params.id }, 'Error revoking tracking tokens');
      return res.status(500).json({ error: 'Failed to revoke tracking links' });
    }
  }
);

// Rate limiter for batch tracking updates
const batchTrackingLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || safeIpKeyGenerator(req),
  store: createStore('rl:tracking-batch:'),
});

// ──────────────────────────────────────────────────────────────────────────
// POST /api/tracking/batch
// Authenticated — uploads buffered GPS coordinates collected while offline.
// Replays the chronological GPS trail to fill tracking gaps and updates current location.
// ──────────────────────────────────────────────────────────────────────────
router.post(
  ['/batch', '/api/tracking/batch'],
  authenticate,
  batchTrackingLimiter,
  async (req, res) => {
    try {
      const userId = req.user?.id || req.body.driver_id;
      if (!userId) {
        return res.status(401).json({ error: 'User must be authenticated' });
      }

      const rawCoords = req.body.coordinates || req.body.locations || req.body;
      if (!Array.isArray(rawCoords) || rawCoords.length === 0) {
        return res.status(400).json({ error: 'coordinates must be a non-empty array' });
      }

      const tripId = req.body.trip_id || null;
      const batchId = req.body.batch_id || null;

      const validLocations = [];
      let newestLocation = null;
      let newestTimestamp = 0;

      for (const point of rawCoords) {
        if (!point || typeof point !== 'object' || Array.isArray(point)) {
          continue;
        }

        const lat = parseFloat(point.latitude !== undefined ? point.latitude : point.lat);
        const lng = parseFloat(point.longitude !== undefined ? point.longitude : point.lng);

        if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
          continue;
        }

        const speed = Number.isFinite(parseFloat(point.speed)) ? parseFloat(point.speed) : null;
        const heading = Number.isFinite(parseFloat(point.heading)) ? parseFloat(point.heading) : null;
        const accuracy = Number.isFinite(parseFloat(point.accuracy)) ? parseFloat(point.accuracy) : null;

        const timeVal = point.timestamp || point.recorded_at || point.time;
        const capturedAt = timeVal ? new Date(timeVal) : new Date();
        if (!Number.isFinite(capturedAt.getTime())) {
          continue;
        }
        const recordedAt = capturedAt.toISOString();

        validLocations.push({
          driver_id: userId,
          latitude: lat,
          longitude: lng,
          speed,
          heading,
          accuracy,
          recorded_at: recordedAt,
        });

        const ts = capturedAt.getTime();
        if (ts > newestTimestamp) {
          newestTimestamp = ts;
          newestLocation = validLocations[validLocations.length - 1];
        }
      }

      if (validLocations.length === 0) {
        return res.status(400).json({ error: 'No valid coordinates found in the batch payload' });
      }

      // Sort valid locations chronologically to replay the exact GPS trail
      validLocations.sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());

      // 1. Replay GPS trail into driver_location_history
      const historyRecords = validLocations.map(loc => ({
        driver_id: loc.driver_id,
        latitude: loc.latitude,
        longitude: loc.longitude,
        speed: loc.speed,
        heading: loc.heading,
        recorded_at: loc.recorded_at,
      }));

      const { error: historyError } = await supabaseAdmin
        .from('driver_location_history')
        .upsert(historyRecords, { onConflict: 'driver_id, recorded_at', ignoreDuplicates: true });

      if (historyError) {
        logger.error({ err: historyError.message, userId }, '[Tracking] Failed to replay location history');
        return res.status(500).json({ error: 'Failed to persist location trail history' });
      }

      // 2. If trip_id is present, log telemetry events to trip_events to fill tracking trail gap
      if (tripId) {
        try {
          const tripRecords = validLocations.map((loc, idx) => ({
            event_id: `offline-gps-${userId}-${new Date(loc.recorded_at).getTime()}-${idx}`,
            user_id: userId,
            trip_id: tripId,
            event_type: 'gpsUpdate',
            event_timestamp: loc.recorded_at,
            latitude: loc.latitude,
            longitude: loc.longitude,
            metadata: {
              speed: loc.speed,
              heading: loc.heading,
              accuracy: loc.accuracy,
              replayed_from_offline: true,
              batch_id: batchId,
            },
            created_at: new Date().toISOString(),
          }));

          await supabaseAdmin
            .from('trip_events')
            .upsert(tripRecords, { onConflict: 'event_id', ignoreDuplicates: true });
        } catch (tripEventErr) {
          logger.warn({ err: tripEventErr.message, tripId }, '[Tracking] Non-fatal: could not log to trip_events');
        }
      }

      // 3. Update current location if this batch has the newest position
      if (newestLocation) {
        const { data: existingLocation } = await supabaseAdmin
          .from('driver_locations')
          .select('recorded_at')
          .eq('driver_id', userId)
          .maybeSingle();

        let updateCurrent = true;
        if (existingLocation && existingLocation.recorded_at) {
          if (newestTimestamp <= new Date(existingLocation.recorded_at).getTime()) {
            updateCurrent = false;
          }
        }

        if (updateCurrent) {
          const { error: currentError } = await supabaseAdmin
            .from('driver_locations')
            .upsert(
              {
                driver_id: userId,
                latitude: newestLocation.latitude,
                longitude: newestLocation.longitude,
                speed: newestLocation.speed,
                heading: newestLocation.heading,
                updated_at: new Date().toISOString(),
                recorded_at: newestLocation.recorded_at,
                is_active: true,
              },
              { onConflict: 'driver_id' }
            );

          if (currentError) {
            logger.error({ err: currentError.message, userId }, '[Tracking] Failed to update newest driver location');
          }
        }
      }

      logger.info({ userId, count: validLocations.length, batchId }, '[Tracking] Replayed GPS trail successfully');

      return res.status(200).json({
        success: true,
        replayed_count: validLocations.length,
        batch_id: batchId,
        latest_coordinate: newestLocation,
        message: `Successfully replayed ${validLocations.length} GPS coordinates`,
      });
    } catch (err) {
      logger.error({ err: err.message }, '[Tracking] Unexpected error processing tracking batch');
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
);

export default router;

