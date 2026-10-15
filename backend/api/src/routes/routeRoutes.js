/**
 * Route Routes
 * 
 * Handles route planning, waypoint optimization, and geocoding integrations.
 * Uses structured error logging for tracing geocoding failures.
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import logger from '../middleware/logger.js';
import { getRoute, getRouteEstimate, validateCoordinates } from '../services/osrm.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// ============================================================================
// GET /api/routes/estimate
// ============================================================================
router.get('/estimate', authenticate, userLimiter, async (req, res) => {
  try {
    const { pickup_lat, pickup_lng, drop_lat, drop_lng, routeId } = req.query;

    const isBlank = (str) =>
      str === undefined ||
      str === null ||
      typeof str === 'boolean' ||
      Array.isArray(str) ||
      (typeof str === 'object' && str !== null) ||
      String(str).trim() === '';

    if (routeId !== undefined && (typeof routeId !== 'string' || routeId.trim() === '')) {
      return res.status(400).json({ error: 'Invalid routeId provided.' });
    }

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
    logger.error(
      { event: 'ROUTE_ESTIMATE_ERROR', requestId: req.requestId || req.id, error: err && err.message },
      'Error calculating route estimate',
    );
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

/**
 * Mock geocoder helper simulating address-to-coordinate conversion.
 */
async function geocodeAddress(address) {
  if (!address || typeof address !== 'string' || address.trim() === '') {
    throw new Error(`Invalid or empty address provided for geocoding: "${address}"`);
  }
  
  // Simulated external geocoding API lookup failure condition
  if (address.toLowerCase().includes('unknown') || address.toLowerCase().includes('invalid')) {
    throw new Error(`Geocoding provider failed to resolve address: "${address}"`);
  }

  // Return mock coordinates [longitude, latitude]
  return { lat: 13.0827, lng: 80.2707 };
}

/**
 * @openapi
 * /api/routes/plan:
 *   post:
 *     tags: [Routes]
 *     summary: Plan a route with origin and destination addresses
 *     description: Geocodes source and destination addresses, calculates route using OSRM, and returns routing details.
 *     security:
 *       - BearerAuth: []
 */
router.post('/plan', authenticate, requirePolicy('route:write'), async (req, res) => {
  try {
    const { origin, destination } = req.body;

    if (!origin || !destination) {
      return res.status(400).json({
        success: false,
        error: 'Both origin and destination are required for route planning.',
      });
    }

    let originCoords, destCoords;

    // Geocode Origin
    try {
      originCoords = await geocodeAddress(origin);
    } catch (geoErr) {
      logger.error(
        {
          requestId: req.requestId || req.id,
          event: 'GEOCODING_ERROR',
          address: origin,
          type: 'origin',
          error: geoErr?.message || geoErr,
        },
        'Geocoding failed for route origin address'
      );
      return res.status(422).json({
        success: false,
        error: `Failed to geocode origin address: ${origin}`,
      });
    }

    // Geocode Destination
    try {
      destCoords = await geocodeAddress(destination);
    } catch (geoErr) {
      logger.error(
        {
          requestId: req.requestId || req.id,
          event: 'GEOCODING_ERROR',
          address: destination,
          type: 'destination',
          error: geoErr?.message || geoErr,
        },
        'Geocoding failed for route destination address'
      );
      return res.status(422).json({
        success: false,
        error: `Failed to geocode destination address: ${destination}`,
      });
    }

    // Fetch route from OSRM service using coordinates [lng, lat]
    const coordinates = [
      [originCoords.lng, originCoords.lat],
      [destCoords.lng, destCoords.lat],
    ];

    const routeData = await getRoute(coordinates);

    if (!routeData) {
      logger.warn(
        {
          requestId: req.requestId || req.id,
          event: 'ROUTE_PLANNING_OSRM_FAILED',
          coordinates,
        },
        'OSRM route calculation returned no results'
      );
      return res.status(502).json({
        success: false,
        error: 'Failed to calculate route from routing provider.',
      });
    }

    logger.info(
      {
        requestId: req.requestId || req.id,
        event: 'ROUTE_PLANNED_SUCCESS',
      },
      'Route planned successfully'
    );

    return res.status(200).json({
      success: true,
      data: {
        origin: originCoords,
        destination: destCoords,
        route: routeData,
      },
    });
  } catch (err) {
    logger.error(
      {
        requestId: req.requestId || req.id,
        event: 'ROUTE_PLANNING_EXCEPTION',
        error: err?.message || err,
      },
      'Unhandled exception during route planning'
    );
    return res.status(500).json({
      success: false,
      error: 'Internal server error while planning route.',
    });
  }
});

export default router;
