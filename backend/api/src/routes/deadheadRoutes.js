import express from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { validateBody } from '../middleware/validate.js';
import { matchDeadheadSchema } from '../validation/requestSchemas.js';
import { matchDeadhead } from '../services/ml.js';
import deadheadMatchingService from '../services/order/deadheadMatchingService.js';
import logger from '../middleware/logger.js';

const router = express.Router();

const deadheadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post(
  '/match/deadhead',
  authenticate,
  deadheadLimiter,
  requirePolicy('load-offer:browse'),
  validateBody(matchDeadheadSchema),
  async (req, res) => {
    try {
      const { driver_destination, truck_specs, arrival_time, available_loads } = req.body;

      const result = await matchDeadhead({
        driverDestination: driver_destination,
        truckSpecs: truck_specs,
        arrivalTime: arrival_time,
        availableLoads: available_loads,
      });

      res.json(result);
    } catch (err) {
      if (err?.message?.includes('[ML]')) {
        logger.warn({ err: err?.message, requestId: req.requestId }, 'ML engine unavailable for deadhead matching');
        return res.status(503).json({ error: 'ML recommendation engine is temporarily unavailable.' });
      }
      logger.error({ err, requestId: req.requestId }, 'Deadhead matching failed');
      return res.status(500).json({ error: 'Deadhead matching failed.' });
    }
  },
);

/**
 * POST /match/mid-trip-opportunities
 * Discovers and ranks candidate mid-trip load offers along driver's route buffer.
 */
router.post(
  '/match/mid-trip-opportunities',
  authenticate,
  deadheadLimiter,
  requirePolicy('load-offer:browse'),
  async (req, res) => {
    try {
      const { active_order_id, current_lat, current_lng, max_detour_km, max_detour_minutes } = req.body || {};
      const driverId = req.user?.id;

      if (!active_order_id || !Number.isFinite(current_lat) || !Number.isFinite(current_lng)) {
        return res.status(400).json({
          error: 'Missing required parameters: active_order_id, current_lat, and current_lng must be provided.',
        });
      }

      const result = await deadheadMatchingService.findMidTripLoadOpportunities({
        driverId,
        activeOrderId: active_order_id,
        currentLat: current_lat,
        currentLng: current_lng,
        maxDetourKm: max_detour_km,
        maxDetourMinutes: max_detour_minutes,
      });

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      logger.error({ err, requestId: req.requestId }, '[Deadhead] Failed to compute mid-trip opportunities');
      return res.status(500).json({ error: 'Failed to compute mid-trip opportunities.' });
    }
  },
);

/**
 * POST /match/insert-mid-trip-waypoint
 * Atomically resequences waypoints on active order to include selected mid-trip load.
 */
router.post(
  '/match/insert-mid-trip-waypoint',
  authenticate,
  deadheadLimiter,
  async (req, res) => {
    try {
      const { order_id, load_offer_id } = req.body || {};
      const driverId = req.user?.id;

      if (!order_id || !load_offer_id) {
        return res.status(400).json({
          error: 'Missing required parameters: order_id and load_offer_id must be provided.',
        });
      }

      const result = await deadheadMatchingService.insertMidTripLoad({
        orderId: order_id,
        loadOfferId: load_offer_id,
        driverId,
      });

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      logger.error({ err, requestId: req.requestId }, '[Deadhead] Failed to insert mid-trip waypoint');
      return res.status(500).json({ error: err.message || 'Failed to insert mid-trip waypoint.' });
    }
  },
);

export default router;
