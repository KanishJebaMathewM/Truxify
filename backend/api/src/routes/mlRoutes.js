import express from 'express';
import crypto from 'crypto';
import { cacheMiddleware } from '../middleware/cacheMiddleware.js';
import { predictDemand, predictPrice, predictEta, matchEnRouteLoads } from '../services/ml.js';
import { supabase } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import logger from '../middleware/logger.js';
import { haversineKm } from '../lib/pricing.js';

const router = express.Router();

function parseCoord(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

// ============================================================================
// 1. GET DEMAND HEATMAP
// GET /api/ml/demand-heatmap
// ============================================================================
router.get(
  '/demand-heatmap',
  authenticate,
  userLimiter,
  cacheMiddleware(300, 'ml_demand_heatmap', (req) => {
    return req.query.zoneId || 'default';
  }),
  async (req, res) => {
    const { zoneId } = req.query;
    try {
      const result = await predictDemand({ zone_id: zoneId || 'zone-1' });
      return res.json(result);
    } catch (err) {
      logger.warn({ err: err.message }, '[ML] Heatmap fallback');
      // Fallback
      return res.json({
        zone_id: zoneId || 'zone-1',
        predicted_demand: 0.75,
        confidence: 0.85,
        recommended_multipliers: { base: 1.2, rush: 1.5 }
      });
    }
  }
);

// ============================================================================
// 3. GET ETA PREDICTION
// GET /api/ml/eta
// ============================================================================
router.get(
  '/eta',
  authenticate,
  userLimiter,
  cacheMiddleware(10, 'ml_eta', (req) => {
    const tripId = req.query.tripId || 'unknown';
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const latBucket = lat ? lat.toFixed(4) : '';
    const lngBucket = lng ? lng.toFixed(4) : '';
    const gpsBucket = `${latBucket},${lngBucket}`;
    return `${tripId}:${gpsBucket}`;
  }),
  async (req, res) => {
    const { routeDistance, timeOfDay, dayOfWeek, routeType, historicalSpeed } = req.query;
    try {
      const result = await predictEta({
        routeDistance: parseFloat(routeDistance || '10'),
        timeOfDay: parseInt(timeOfDay || '12'),
        dayOfWeek: parseInt(dayOfWeek || '1'),
        routeType: routeType || 'highway',
        historicalSpeed: parseFloat(historicalSpeed || '60')
      });
      return res.json(result);
    } catch (err) {
      logger.warn({ err: err.message }, '[ML] ETA fallback');
      // Fallback
      return res.json({
        eta_minutes: 25.5,
        confidence_interval: { lower: 20, upper: 30 }
      });
    }
  }
);

// ============================================================================
// 4. GET ENROUTE LOADS
// GET /api/ml/enroute-loads
// ============================================================================
router.get(
  '/enroute-loads',
  authenticate,
  userLimiter,
  async (req, res) => {
    const { lat, lng, maxDetour } = req.query;
    try {
      const currentLat = parseFloat(lat);
      const currentLng = parseFloat(lng);
      const maxDetourKm = parseFloat(maxDetour || '10');

      if (isNaN(currentLat) || isNaN(currentLng)) {
        return res.status(400).json({ error: 'Valid lat and lng query parameters are required.' });
      }

      // 1. Fetch available load offers
      const { data: offers, error: offersError } = await supabase
        .from('load_offers')
        .select('*')
        .eq('status', 'available');

      if (offersError) {
        logger.error('Failed to fetch available offers for en-route matching:', offersError);
        return res.status(500).json({ error: 'Failed to fetch available load offers.' });
      }

      // 2. Fetch driver's details to get truck specs
      const { data: details } = await supabase
        .from('driver_details')
        .select('truck_id')
        .eq('user_id', req.user.id)
        .maybeSingle();

      let truckSpecs = null;
      if (details?.truck_id) {
        const { data: truck } = await supabase
          .from('trucks')
          .select('*')
          .eq('id', details.truck_id)
          .maybeSingle();

        if (truck) {
          truckSpecs = {
            max_weight_kg: (truck.max_capacity_tons || 1.5) * 1000,
            max_length_m: 4.0,
            max_width_m: 2.0,
            max_height_m: 2.0,
          };
        }
      }

      // 3. Call ML matching
      const recommendations = await matchEnRouteLoads({
        currentLat,
        currentLng,
        offers: offers || [],
        truckSpecs,
        maxDetourKm,
      });

      return res.json({ recommendations });
    } catch (err) {
      logger.error({ err: err.message }, '[ML] En-route loads error');
      return res.status(500).json({ error: 'An error occurred during en-route loads matching.' });
    }
  }
);

export default router;
