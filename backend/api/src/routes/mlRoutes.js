import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import { cacheMiddleware } from '../middleware/cacheMiddleware.js';
// Verified single import for predictEta to prevent SyntaxError (#14873)
import { predictDemand, predictPrice, predictEta, matchEnRouteLoads, getAbTestingStatus, rollbackAbTest } from '../services/ml.js';
import { supabase, supabaseAdmin, createUserClient } from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import logger from '../middleware/logger.js';
import { haversineKm } from '../lib/pricing.js';

const router = express.Router();

// Sanitize a trip identifier before interpolating it into a PostgREST `.or()`
// filter. The filter grammar treats `)`, `,`, quotes and whitespace as syntax,
// so an unsanitized value could break out of the intended predicate
// (injection / malformed query / DoS). Rejects any such characters.
function sanitizeTripId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (/[,)(\s'"]/.test(trimmed)) return null;
  return trimmed;
}

/**
 * GET /api/ml/eta?tripId=...&lat=...&lng=...
 * Retrieves route ETA and distance for a specific trip with strict ownership validation.
 */
router.get('/eta', authenticate, userLimiter, async (req, res) => {
  try {
    const { tripId, lat, lng } = req.query;
    if (!tripId || typeof tripId !== 'string' || tripId.trim() === '') {
      return res.status(400).json({ error: 'tripId is required.' });
    }

    // Sanitize before interpolating into the PostgREST filter (see sanitizeTripId).
    const safeTripId = sanitizeTripId(tripId);
    if (!safeTripId) {
      return res.status(400).json({ error: 'tripId contains invalid characters.' });
    }

    // Resolve the trip by primary key or display id, then its linked order for
    // the drop coordinates that define the remaining route.
    const dbClient = supabaseAdmin || (typeof createUserClient === 'function' ? createUserClient(req.token) : supabase);
    const { data: trip, error: tripErr } = await dbClient
      .from('trips')
      .select('id, trip_display_id, order_id')
      .or(`id.eq.${safeTripId},trip_display_id.eq.${safeTripId}`)
      .maybeSingle();

    if (tripErr) {
      logger.error('[MlEta] Failed to resolve trip:', tripErr);
      return res.status(500).json({ error: 'Failed to resolve trip.' });
    }
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found.' });
    }

    let order = null;
    if (trip.order_id) {
      const { data: orderRes, error: orderErr } = await dbClient
        .from('orders')
        .select('pickup_lat, pickup_lng, drop_lat, drop_lng, customer_id, driver_id')
        .eq('id', trip.order_id)
        .maybeSingle();

      if (orderErr) {
        logger.error('[MlEta] Failed to resolve order for trip:', orderErr);
        return res.status(500).json({ error: 'Failed to resolve order.' });
      }
      order = orderRes;
    }

    if (!order || !order.drop_lat || !order.drop_lng) {
      return res.status(422).json({ error: 'Trip has no destination coordinates for ETA.' });
    }

    if (req.user && req.user.role !== 'admin') {
      const isOwner =
        order.customer_id === req.user.id || order.driver_id === req.user.id;
      if (!isOwner) {
        return res.status(404).json({ error: 'Trip not found.' });
      }
    }

    const currentLat = parseCoord(lat, -90, 90);
    const currentLng = parseCoord(lng, -180, 180);

    const latProvided = lat !== undefined && lat !== null && lat !== '';
    const lngProvided = lng !== undefined && lng !== null && lng !== '';

    if (latProvided !== lngProvided) {
      return res.status(400).json({ error: 'Both lat and lng must be provided together.' });
    }

    let positionSource = 'pickup';
    let distanceKm;
    if (latProvided) {
      if (currentLat === null || currentLng === null) {
        return res.status(400).json({ error: 'Invalid lat/lng: lat must be within [-90, 90] and lng within [-180, 180].' });
      }
      if (currentLat === 0 && currentLng === 0) {
        return res.status(422).json({ error: 'lat/lng at (0,0) is not a valid live position.' });
      }
      positionSource = 'live';
      distanceKm = haversineKm(currentLat, currentLng, Number(order.drop_lat), Number(order.drop_lng));
    } else {
      distanceKm = haversineKm(Number(order.pickup_lat), Number(order.pickup_lng), Number(order.drop_lat), Number(order.drop_lng));
    }

    const now = new Date();
    const routeType = distanceKm > 20 ? 'highway' : 'city';

    try {
      const prediction = await predictEta({
        routeDistance: distanceKm,
        timeOfDay: now.getHours(),
        dayOfWeek: now.getDay(),
        routeType,
        historicalSpeed: routeType === 'highway' ? 55 : 40,
      });

      return res.json({
        tripId: trip.trip_display_id || trip.id,
        eta_minutes: prediction.eta_minutes,
        confidence_interval: prediction.confidence_interval,
        distance_km: Math.round(distanceKm * 100) / 100,
        route_type: routeType,
        source: 'ml',
        position_source: positionSource,
      });
    } catch (mlErr) {
      logger.warn('[MlEta] ML ETA prediction failed:', mlErr.message);
      return res.status(503).json({ error: mlErr.message });
    }
  } catch (err) {
    logger.error('Internal Server Error in GET /api/ml/eta:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});


/**
 * @swagger
 * components:
 *   schemas:
 *     MlEtaResponse:
 *       type: object
 *       required:
 *         - eta_minutes
 *         - confidence_interval
 *       properties:
 *         eta_minutes:
 *           type: number
 *           format: float
 *           minimum: 0
 *           example: 25.5
 *         confidence_interval:
 *           type: object
 *           required:
 *             - lower
 *             - upper
 *           properties:
 *             lower:
 *               type: number
 *               format: float
 *               minimum: 0
 *               example: 20
 *             upper:
 *               type: number
 *               format: float
 *               minimum: 0
 *               example: 30
 */

function parseCoord(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

const LAT_MIN = -90;
const LAT_MAX = 90;
const LNG_MIN = -180;
const LNG_MAX = 180;
const MAX_DETOUR_MIN_KM = 0.1;
const MAX_DETOUR_MAX_KM = 500;
const DEFAULT_MAX_DETOUR_KM = 10;

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
/**
 * @swagger
 * /api/ml/eta:
 *   get:
 *     summary: Get an ML-based ETA prediction
 *     description: Predicts ETA from route distance, time-of-day, day-of-week, route type, and historical speed. Optional trip and GPS query values are also included in the short-lived response-cache key.
 *     tags:
 *       - Machine Learning
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: routeDistance
 *         required: false
 *         description: Route distance in kilometres. Defaults to 10.
 *         schema:
 *           type: number
 *           format: float
 *           minimum: 0
 *           default: 10
 *       - in: query
 *         name: timeOfDay
 *         required: false
 *         description: Hour of day used by the ETA model. Defaults to 12.
 *         schema:
 *           type: integer
 *           minimum: 0
 *           maximum: 23
 *           default: 12
 *       - in: query
 *         name: dayOfWeek
 *         required: false
 *         description: Day of week where 0 is Sunday and 6 is Saturday. Defaults to 1.
 *         schema:
 *           type: integer
 *           minimum: 0
 *           maximum: 6
 *           default: 1
 *       - in: query
 *         name: routeType
 *         required: false
 *         description: Route classification supplied to the ETA model.
 *         schema:
 *           type: string
 *           default: highway
 *           example: highway
 *       - in: query
 *         name: historicalSpeed
 *         required: false
 *         description: Historical average speed in kilometres per hour. Defaults to 60.
 *         schema:
 *           type: number
 *           format: float
 *           minimum: 0
 *           default: 60
 *       - in: query
 *         name: tripId
 *         required: false
 *         description: Optional trip identifier used to separate cached ETA responses.
 *         schema:
 *           type: string
 *       - in: query
 *         name: lat
 *         required: false
 *         description: Optional latitude value used in the response-cache key.
 *         schema:
 *           type: number
 *           format: float
 *           minimum: -90
 *           maximum: 90
 *       - in: query
 *         name: lng
 *         required: false
 *         description: Optional longitude value used in the response-cache key.
 *         schema:
 *           type: number
 *           format: float
 *           minimum: -180
 *           maximum: 180
 *     responses:
 *       '200':
 *         description: ETA prediction from the ML engine or deterministic fallback.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MlEtaResponse'
 */
router.get(
  '/eta',
  authenticate,
  userLimiter,
  cacheMiddleware(10, 'ml_eta', (req) => {
    const tripId = req.query.tripId || 'unknown';
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const latBucket = Number.isFinite(lat) ? lat.toFixed(4) : '';
    const lngBucket = Number.isFinite(lng) ? lng.toFixed(4) : '';
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
      const parsedDistance = parseFloat(routeDistance);
      const parsedTime = parseInt(timeOfDay, 10);
      const parsedDay = parseInt(dayOfWeek, 10);
      const parsedSpeed = parseFloat(historicalSpeed);
      const result = await predictEta({
        routeDistance: Number.isFinite(parsedDistance) ? parsedDistance : 10,
        timeOfDay: Number.isFinite(parsedTime) ? parsedTime : 12,
        dayOfWeek: Number.isFinite(parsedDay) ? parsedDay : 1,
        routeType: routeType || 'highway',
        historicalSpeed: Number.isFinite(parsedSpeed) ? parsedSpeed : 60
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
      const currentLat = parseCoord(lat, LAT_MIN, LAT_MAX);
      const currentLng = parseCoord(lng, LNG_MIN, LNG_MAX);

      if (currentLat === null || currentLng === null) {
        return res.status(400).json({
          error: `lat must be a number between ${LAT_MIN} and ${LAT_MAX} and lng a number between ${LNG_MIN} and ${LNG_MAX}.`,
        });
      }

      // An unparseable maxDetour used to reach the haversine fallback as NaN,
      // where `x <= NaN` is always false — the endpoint answered 200 with an
      // empty list, hiding a client error as "no en-route loads".
      const maxDetourKm =
        maxDetour === undefined
          ? DEFAULT_MAX_DETOUR_KM
          : parseCoord(maxDetour, MAX_DETOUR_MIN_KM, MAX_DETOUR_MAX_KM);

      if (maxDetourKm === null) {
        return res.status(400).json({
          error: `maxDetour must be a number between ${MAX_DETOUR_MIN_KM} and ${MAX_DETOUR_MAX_KM}.`,
        });
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
/**
 * @openapi
 * components:
 *   securitySchemes:
 *     BearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     MlAbTestingStatusResponse:
 *       type: object
 *       required: [status, active_test, timestamp]
 *       properties:
 *         status:
 *           type: string
 *           enum: [active]
 *           description: Current A/B testing lifecycle status.
 *           example: active
 *         active_test:
 *           type: object
 *           nullable: true
 *           required: [test_id, production_version, shadow_version, started_at, status]
 *           properties:
 *             test_id:
 *               type: string
 *               example: test-2026-09-19
 *             production_version:
 *               type: string
 *               example: generation-42
 *             shadow_version:
 *               type: string
 *               example: generation-43
 *             started_at:
 *               type: string
 *               format: date-time
 *             status:
 *               type: string
 *               example: active
 *         timestamp:
 *           type: string
 *           format: date-time
 * /api/ml/ab-testing/status:
 *   get:
 *     tags: [ML A/B Testing]
 *     summary: Get ML A/B-testing status
 *     description: Returns the current ML A/B-testing status and active test metadata for administrators.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Current A/B-testing status.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MlAbTestingStatusResponse'
 *       401:
 *         description: Authentication is required.
 *       403:
 *         description: Caller does not have administrator privileges.
 *       429:
 *         description: Rate limit exceeded.
 *       502:
 *         description: Failed to fetch A/B-testing status from the ML engine.
 */
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
// ============================================================================
// ML PROXY LAYER & FAILURE PATH HANDLING
// ============================================================================
const ML_BASE_URL = process.env.ML_SERVICE_URL || process.env.ML_ENGINE_URL || 'http://localhost:8000';
const ML_API_KEY = process.env.ML_API_KEY || '';
const ML_REQUEST_TIMEOUT_MS = Number(process.env.ML_REQUEST_TIMEOUT_MS) || 5000;

function getMlHeaders() {
  return {
    'Content-Type': 'application/json',
    ...(ML_API_KEY ? { 'X-API-Key': ML_API_KEY } : {}),
  };
}

/**
 * Proxy helper with strict failure path handling:
 * - 503 { error: 'ML_SERVICE_UNAVAILABLE' } when FastAPI is down/unreachable or returns 503
 * - 400 with error detail when FastAPI returns 422 validation error
 * - 502 { error: 'ML_INVALID_SCHEMA' } when FastAPI returns an unexpected schema
 * - 200 on success
 */
async function proxyMlRequest(req, res, { path, body, validateSchema, transformResponse }) {
  try {
    const targetUrl = `${ML_BASE_URL}${path}`;
    const response = await axios.post(targetUrl, body || req.body, {
      headers: getMlHeaders(),
      timeout: ML_REQUEST_TIMEOUT_MS,
    });

    const data = response.data;

    if (validateSchema && !validateSchema(data)) {
      logger.warn({ path, data }, '[ML Proxy] FastAPI returned unexpected schema');
      return res.status(502).json({
        error: 'ML_INVALID_SCHEMA',
        message: 'FastAPI returned an unexpected response schema',
      });
    }

    const payload = transformResponse ? transformResponse(data) : data;
    return res.status(200).json(payload);
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      if (status === 422) {
        logger.warn({ path, detail: err.response.data }, '[ML Proxy] FastAPI 422 validation error');
        return res.status(400).json({
          error: 'Validation failed',
          detail: err.response.data?.detail || err.response.data,
        });
      }
      if (status === 503) {
        logger.error({ path }, '[ML Proxy] FastAPI 503 Service Unavailable');
        return res.status(503).json({
          error: 'ML_SERVICE_UNAVAILABLE',
          message: 'ML prediction service is unavailable',
        });
      }
      logger.error({ path, status, data: err.response.data }, '[ML Proxy] FastAPI response error');
      return res.status(status).json(err.response.data || { error: 'ML_SERVICE_ERROR' });
    }

    // Network / unreachable error (ECONNREFUSED, ENOTFOUND, timeout, etc.)
    logger.error({ path, message: err.message }, '[ML Proxy] FastAPI service unreachable');
    return res.status(503).json({
      error: 'ML_SERVICE_UNAVAILABLE',
      message: 'ML prediction service is currently unreachable',
    });
  }
}

/**
 * POST /api/ml/eta
 * Proxies ETA prediction to FastAPI /predict/eta.
 * Validates schema, returns { eta_minutes, confidence }
 */
router.post('/eta', authenticate, userLimiter, async (req, res) => {
  return proxyMlRequest(req, res, {
    path: '/predict/eta',
    validateSchema: (data) => {
      if (!data || typeof data !== 'object') return false;
      return typeof data.eta_minutes === 'number';
    },
    transformResponse: (data) => {
      return {
        eta_minutes: data.eta_minutes,
        confidence: data.confidence !== undefined
          ? data.confidence
          : (data.confidence_interval?.lower !== undefined ? 0.9 : 0.85),
        ...data,
      };
    },
  });
});

/**
 * POST /api/ml/pricing
 * Proxies price prediction to FastAPI /predict/price.
 * Validates OpenAPI schema (PricePredictOutput: estimated_price, min_price, max_price, currency).
 */
router.post('/pricing', authenticate, userLimiter, async (req, res) => {
  return proxyMlRequest(req, res, {
    path: '/predict/price',
    validateSchema: (data) => {
      if (!data || typeof data !== 'object') return false;
      return typeof data.estimated_price === 'number';
    },
    transformResponse: (data) => {
      return {
        currency: 'INR',
        min_price: data.min_price !== undefined ? data.min_price : Number((data.estimated_price * 0.9).toFixed(2)),
        max_price: data.max_price !== undefined ? data.max_price : Number((data.estimated_price * 1.1).toFixed(2)),
        ...data,
      };
    },
  });
});

const MAX_VRP_PAYLOAD_BYTES = 64 * 1024; // 64 KB
const MAX_VRP_STOPS = 50;

/**
 * POST /api/ml/vrp
 * Proxies VRP route optimization to FastAPI /optimise/packing.
 * Enforces payload size limit before forwarding.
 */
router.post('/vrp', authenticate, userLimiter, async (req, res) => {
  const rawContentLength = req.headers['content-length'];
  const payloadBytes = rawContentLength
    ? parseInt(rawContentLength, 10)
    : Buffer.byteLength(JSON.stringify(req.body || {}));

  const stops = req.body?.stops || req.body?.delivery_addresses || req.body?.packages;
  const stopCount = Array.isArray(stops) ? stops.length : 0;

  if (payloadBytes > MAX_VRP_PAYLOAD_BYTES || stopCount > MAX_VRP_STOPS) {
    logger.warn({ payloadBytes, stopCount }, '[ML Proxy] VRP payload too large');
    return res.status(413).json({
      error: 'PAYLOAD_TOO_LARGE',
      message: 'VRP payload exceeds allowed limit',
    });
  }

  return proxyMlRequest(req, res, {
    path: '/optimise/packing',
    validateSchema: (data) => {
      if (!data || typeof data !== 'object') return false;
      return true;
    },
  });
});

export default router;
