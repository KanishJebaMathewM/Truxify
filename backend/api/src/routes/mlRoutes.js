import express from 'express';
import crypto from 'crypto';
import { cacheMiddleware } from '../middleware/cacheMiddleware.js';
// Verified single import for predictEta to prevent SyntaxError (#14873)
import { predictDemand, predictPrice, predictEta, matchEnRouteLoads, getAbTestingStatus, rollbackAbTest } from '../services/ml.js';
import { supabase } from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import logger from '../middleware/logger.js';
import { haversineKm } from '../lib/pricing.js';

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     MlEnrouteLoadRecommendation:
 *       type: object
 *       properties:
 *         load_id:
 *           type: string
 *         detour_km:
 *           type: number
 *           format: float
 *           minimum: 0
 *         extra_earnings:
 *           type: number
 *           format: float
 *           minimum: 0
 *         match_score:
 *           type: number
 *           format: float
 *         extra_distance_km:
 *           type: number
 *           format: float
 *           minimum: 0
 *         ml_used:
 *           type: boolean
 *       additionalProperties: true
 *     MlEnrouteLoadsResponse:
 *       type: object
 *       required:
 *         - recommendations
 *       properties:
 *         recommendations:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/MlEnrouteLoadRecommendation'
 */

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
    const routeDistance = req.query.routeDistance || '10';
    const timeOfDay = req.query.timeOfDay || '12';
    const dayOfWeek = req.query.dayOfWeek || '1';
    const routeType = req.query.routeType || 'highway';
    const historicalSpeed = req.query.historicalSpeed || '60';
    return `${tripId}:${gpsBucket}:${routeDistance}:${timeOfDay}:${dayOfWeek}:${routeType}:${historicalSpeed}`;
  }),
  async (req, res) => {
    const { routeDistance, timeOfDay, dayOfWeek, routeType, historicalSpeed } = req.query;
    try {
      const result = await predictEta({
        routeDistance: parseFloat(routeDistance || '10'),
        timeOfDay: parseInt(timeOfDay || '12', 10),
        dayOfWeek: parseInt(dayOfWeek || '1', 10),
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
/**
 * @swagger
 * /api/ml/enroute-loads:
 *   get:
 *     summary: Find en-route load recommendations
 *     description: Returns available load recommendations near the driver's current position, limited by the requested maximum detour. Matching uses the ML engine with a haversine-distance fallback when the ML service is unavailable.
 *     tags:
 *       - Machine Learning
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: lat
 *         required: true
 *         description: Current driver latitude.
 *         schema:
 *           type: number
 *           format: float
 *           minimum: -90
 *           maximum: 90
 *       - in: query
 *         name: lng
 *         required: true
 *         description: Current driver longitude.
 *         schema:
 *           type: number
 *           format: float
 *           minimum: -180
 *           maximum: 180
 *       - in: query
 *         name: maxDetour
 *         required: false
 *         description: Maximum accepted detour in kilometres. Defaults to 10 and must be greater than 0 and no greater than 500.
 *         schema:
 *           type: number
 *           format: float
 *           exclusiveMinimum: true
 *           minimum: 0
 *           maximum: 500
 *           default: 10
 *     responses:
 *       '200':
 *         description: En-route load recommendations.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MlEnrouteLoadsResponse'
 *       '400':
 *         description: Invalid or missing coordinates, or an invalid maximum detour.
 *       '401':
 *         description: Authentication required.
 *       '500':
 *         description: Failed to load offers or match en-route recommendations.
 */
router.get(
  '/enroute-loads',
  authenticate,
  userLimiter,
  async (req, res) => {
    const { lat, lng, maxDetour } = req.query;
    try {
      const currentLat = parseCoord(lat, -90, 90);
      const currentLng = parseCoord(lng, -180, 180);
      const maxDetourKm = parseFloat(maxDetour || '10');

      if (currentLat === null || currentLng === null) {
        return res.status(400).json({ error: 'Valid lat (-90 to 90) and lng (-180 to 180) query parameters are required.' });
      }

      if (isNaN(maxDetourKm) || maxDetourKm <= 0 || maxDetourKm > 500) {
        return res.status(400).json({ error: 'maxDetour must be a positive number between 0.1 and 500 km.' });
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
// ============================================================================
// 5. A/B TESTING STATUS & ROLLBACK (ADMIN PROXIED)
// ============================================================================
router.get(
  '/ab-testing/status',
  authenticate,
  requireRole(['admin']),
  async (req, res) => {
    try {
      const status = await getAbTestingStatus();
      return res.json(status);
    } catch (err) {
      logger.error({ err: err.message }, '[ML] Failed to fetch A/B testing status');
      return res.status(502).json({ error: 'Failed to fetch A/B testing status from ML engine.' });
    }
  }
);

router.post(
  '/ab-testing/rollback/:testId',
  authenticate,
  requireRole(['admin']),
  async (req, res) => {
    try {
      const { testId } = req.params;
      const result = await rollbackAbTest(testId);
      return res.json(result);
    } catch (err) {
      logger.error({ err: err.message }, '[ML] Failed to rollback A/B test');
      return res.status(502).json({ error: 'Failed to trigger rollback on ML engine.' });
    }
  }
);

export default router;
