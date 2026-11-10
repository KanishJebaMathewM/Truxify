/**
 * Route Routes
 * 
 * Handles route planning, waypoint optimization, and geocoding integrations.
 * Uses structured error logging for tracing geocoding failures.
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/policy.js';
import logger from '../middleware/logger.js';
import { getRoute } from '../services/osrm.js';

const router = express.Router();

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
