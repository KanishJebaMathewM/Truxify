import express from 'express';
import { getRouteEstimate, validateCoordinates } from '../services/osrm.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import logger from '../middleware/logger.js';

const router = express.Router();

// ============================================================================
// GET /api/routes/estimate
// ============================================================================
router.get('/estimate', authenticate, userLimiter, async (req, res) => {
  try {
    const { pickup_lat, pickup_lng, drop_lat, drop_lng } = req.query;

    const isBlank = (str) => !str || String(str).trim() === '';
    if (isBlank(pickup_lat) || isBlank(pickup_lng) || isBlank(drop_lat) || isBlank(drop_lng)) {
      return res.status(400).json({ error: 'Invalid coordinates provided.' });
    }

    const pickupLat = Number(pickup_lat);
    const pickupLng = Number(pickup_lng);
    const dropLat = Number(drop_lat);
    const dropLng = Number(drop_lng);

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
      distance_km: estimate.distanceKm,
      duration_hours: estimate.durationSeconds ? Number((estimate.durationSeconds / 3600).toFixed(2)) : null
    });
  } catch (err) {
    logger.error('Error calculating route estimate:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
