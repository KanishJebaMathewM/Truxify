import express from 'express';
import { getRouteEstimate, validateCoordinates } from '../services/osrm.js';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import logger from '../middleware/logger.js';

const router = express.Router();

// ============================================================================
// POST /api/routes/plan
// ============================================================================
router.post('/plan', authenticate, userLimiter, requirePolicy('route:plan'), async (req, res, next) => {
  try {
    const { origin, destination, routeId } = req.body;

    const isBlank = (str) => !str || String(str).trim() === '';
    if (routeId !== undefined && (typeof routeId !== 'string' || routeId.trim() === '')) {
      return res.status(400).json({ error: 'Invalid routeId provided.' });
    }

    if (!origin || !destination || isBlank(origin.lat) || isBlank(origin.lng) || isBlank(destination.lat) || isBlank(destination.lng)) {
      return res.status(400).json({ error: 'Invalid origin or destination coordinates provided.' });
    }

    const pickupLat = Number(origin.lat);
    const pickupLng = Number(origin.lng);
    const dropLat = Number(destination.lat);
    const dropLng = Number(destination.lng);

    const validationError = validateCoordinates(pickupLat, pickupLng, dropLat, dropLng);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const estimate = await getRouteEstimate({
      pickupLat,
      pickupLng,
      dropLat,
      dropLng
    });

    if (!estimate) {
      return res.status(404).json({ error: 'Could not calculate route for given coordinates.' });
    }

    return res.json({
      success: true,
      data: {
        distance_km: estimate.distanceKm,
        duration_hours: estimate.durationSeconds ? Number((estimate.durationSeconds / 3600).toFixed(2)) : null
      }
    });
  } catch (err) {
    logger.error(
      { event: 'ROUTE_PLAN_ERROR', requestId: req.requestId || req.id, error: err && err.message },
      'Error planning route',
    );
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
