import express from 'express';
import { createUserClient } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import logger from '../middleware/logger.js';
import { predictDemand } from '../services/ml.js';
import { demandConfig } from '../config/demand.js';

const router = express.Router();

/**
 * @openapi
 * components:
 *   schemas:
 *     DemandHeatmapFeature:
 *       type: object
 *       required:
 *         - type
 *         - geometry
 *         - properties
 *       properties:
 *         type:
 *           type: string
 *           enum:
 *             - Feature
 *         geometry:
 *           type: object
 *           required:
 *             - type
 *             - coordinates
 *           properties:
 *             type:
 *               type: string
 *               enum:
 *                 - Point
 *             coordinates:
 *               type: array
 *               minItems: 2
 *               maxItems: 2
 *               items:
 *                 type: number
 *         properties:
 *           type: object
 *           properties:
 *             intensity:
 *               type: number
 *             status:
 *               type: string
 *             address:
 *               type: string
 *     DemandHeatmapResponse:
 *       type: object
 *       properties:
 *         type:
 *           type: string
 *           enum:
 *             - FeatureCollection
 *         features:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/DemandHeatmapFeature'
 *         routeSuggestions:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               id:
 *                 type: integer
 *               recommendedRoute:
 *                 type: string
 *               estimatedEarnings:
 *                 type: number
 *               confidenceScore:
 *                 type: number
 *         estimatedEarningPotential:
 *           type: number
 *         predictedDemandNext48Hours:
 *           type: object
 *           properties:
 *             next24Hours:
 *               type: number
 *             next48Hours:
 *               type: number
 *             peakHours:
 *               type: array
 *               items:
 *                 type: integer
 *         repositioningAreas:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               zone:
 *                 type: string
 *               suggestedDrivers:
 *                 type: integer
 *               priority:
 *                 type: string
 *               isMockData:
 *                 type: boolean
 *         filtersApplied:
 *           type: object
 *           properties:
 *             vehicle_type:
 *               type: string
 *               nullable: true
 *             cargo_category:
 *               type: string
 *               nullable: true
 */



// ============================================================================
// 1. GET DEMAND HEATMAP
// GET /api/demand-heatmap
// ============================================================================
/**
 * @openapi
 * /api/demand-heatmap:
 *   get:
 *     tags:
 *       - Demand Analytics
 *     summary: Retrieve the demand heatmap
 *     description: Returns GeoJSON demand data with route suggestions, earnings estimates, forecast demand, and repositioning recommendations.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - name: vehicle_type
 *         in: query
 *         required: false
 *         description: Optional vehicle type filter.
 *         schema:
 *           type: string
 *         example: Truck
 *       - name: cargo_category
 *         in: query
 *         required: false
 *         description: Optional cargo category filter matched against goods_type.
 *         schema:
 *           type: string
 *         example: Electronics
 *     responses:
 *       200:
 *         description: Demand heatmap data.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DemandHeatmapResponse'
 *       400:
 *         description: Invalid query filter value.
 *       401:
 *         description: Authentication is required.
 *       403:
 *         description: The authenticated caller lacks the demand:view-heatmap policy.
 *       429:
 *         description: Rate limit exceeded.
 *       500:
 *         description: Failed to fetch or calculate heatmap data.
 */

router.get('/', authenticate, userLimiter, requirePolicy('demand:view-heatmap'), async (req, res) => {
  try {
    // Extract optional query filters for vehicle type and cargo category
    const { vehicle_type, cargo_category } = req.query;

    if (vehicle_type && typeof vehicle_type !== 'string') {
      return res.status(400).json({ error: 'vehicle_type must be a single string' });
    }
    if (cargo_category && typeof cargo_category !== 'string') {
      return res.status(400).json({ error: 'cargo_category must be a single string' });
    }

    // 1. Fetch recent load offers (historical/current volume)
    // Read through the caller's user-scoped client so the load_offers RLS
    // policy (status = 'available' OR customer_id = get_profile_id()) sees the
    // authenticated user's identity. The shared anon client has no identity and
    // can never return the offers.
    const userClient = createUserClient(req.token);
    const { data: loads, error } = await userClient
      .from('load_offers')
      .select('pickup_address, drop_address, status, pickup_lat, pickup_lng, goods_type')
      .in('status', ['available', 'claimed'])
      .limit(100);

    if (error) {
      logger.error('Failed to fetch historical volume for heatmap:', error);
      return res.status(500).json({ error: 'Failed to fetch heatmap data.' });
    }

    // Apply the filters in JS: load_offers has no vehicle_type / cargo_category
    // columns (same convention as the marketplace board in loadRoutes.js, where
    // vehicle_type is a synthetic 'Truck' value). cargo_category maps onto the
    // real goods_type column.
    let filteredLoads = loads || [];
    if (vehicle_type && vehicle_type.toLowerCase() !== 'truck') {
      filteredLoads = [];
    }
    if (cargo_category) {
      filteredLoads = filteredLoads.filter(
        (l) => String(l.goods_type || '').toLowerCase() === cargo_category.toLowerCase()
      );
    }

    // 2. Fetch ML prediction aggregation for high-demand zones & route insights
    let mlPrediction = { predicted_demand: 0.5 };
    try {
      mlPrediction = await predictDemand({
        hour: new Date().getHours(),
        day_of_week: new Date().getDay(),
        temperature: 25.0,
        precipitation: 0,
        historical_volume: filteredLoads?.length || 0,
        nearby_drivers: 0,
      });
    } catch (mlErr) {
      logger.warn('[DemandHeatmap] ML engine prediction failed, falling back to basic data:', mlErr?.message ?? String(mlErr));
    }

    // Generate intelligent route recommendations and earnings potential based on ML predictions
    const baseEarningRate = demandConfig.baseEarningRate; // per km estimate
    const multiplier = mlPrediction.predicted_demand || 0.5;
    const estimatedEarningPotential = Number((baseEarningRate * (1 + multiplier)).toFixed(2));

    const routeSuggestions = (filteredLoads || []).slice(0, 3).map((l, idx) => ({
      id: idx + 1,
      recommendedRoute: `${l.pickup_address || 'Current Location'} -> ${l.drop_address || 'High Demand Zone'}`,
      estimatedEarnings: estimatedEarningPotential * (demandConfig.routeMultiplierBase + idx * demandConfig.routeMultiplierStep),
      confidenceScore: Number((multiplier * 100).toFixed(1))
    }));

    const predictedDemandNext48Hours = {
      next24Hours: Number((multiplier * demandConfig.next24HoursFactor).toFixed(2)),
      next48Hours: Number((multiplier * demandConfig.next48HoursFactor).toFixed(2)),
      peakHours: demandConfig.peakHours
    };

    const repositioningAreas = [
      { zone: 'Central Hub / Logistics District', suggestedDrivers: 5, priority: 'HIGH', isMockData: true },
      { zone: 'Industrial Corridor Sector B', suggestedDrivers: 3, priority: 'MEDIUM', isMockData: true }
    ];

    // 3. Construct GeoJSON
    const features = (filteredLoads || []).map((load) => {
      const lat = load.pickup_lat;
      const lng = load.pickup_lng;

      if (lat === null || lng == null) {
        return null;
      }

      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [lng, lat]
        },
        properties: {
          intensity: mlPrediction.predicted_demand || 0.5,
          status: load.status,
          address: load.pickup_address
        }
      };
    }).filter(Boolean);

    const geoJson = {
      type: "FeatureCollection",
      features
    };

    res.json({
      ...geoJson,
      routeSuggestions,
      estimatedEarningPotential,
      predictedDemandNext48Hours,
      repositioningAreas,
      filtersApplied: { vehicle_type: vehicle_type || null, cargo_category: cargo_category || null }
    });

  } catch (err) {
    logger.error('Internal Server Error in GET /api/demand-heatmap:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;


  // ============================================================================
  // TRUXIFY ENTERPRISE DEMAND ANALYTICS & QUERY SANITIZATION SUBSYSTEM (#14636)
  // Provides robust null-guarding, geo-bound sanitization, and fallback telemetry.
  // ============================================================================
  function sanitizeDemandQueryParameters(query) {
    const sanitized = {};
    if (!query) return sanitized;
    
    // Normalize and guard geographical bounds
    sanitized.latitude = query.lat !== undefined ? Number(query.lat) : null;
    sanitized.longitude = query.lng !== undefined ? Number(query.lng) : null;
    sanitized.radiusKm = query.radius !== undefined ? Math.min(Number(query.radius), 100) : 15;
    sanitized.timeWindow = query.window || '24h';
    
    if (sanitized.latitude !== null && (isNaN(sanitized.latitude) || Math.abs(sanitized.latitude) > 90)) {
      throw new Error('Invalid latitude parameter supplied for demand query');
    }
    if (sanitized.longitude !== null && (isNaN(sanitized.longitude) || Math.abs(sanitized.longitude) > 180)) {
      throw new Error('Invalid longitude parameter supplied for demand query');
    }
    
    return sanitized;
  }

  function emitDemandTelemetryAudit(endpoint, actorId, errorPayload) {
    try {
      const auditRecord = {
        timestamp: new Date().toISOString(),
        endpoint,
        actorId: actorId || 'anonymous_system_actor',
        errorDetails: errorPayload?.message ?? String(errorPayload),
        severity: 'WARNING'
      };
      // Non-blocking telemetry audit emission hook
      if (typeof logger !== 'undefined' && logger.debug) {
        logger.debug(auditRecord, '[Demand Telemetry Audit] Recorded exception state.');
      }
    } catch (auditErr) {
      // Fail-safe suppression for audit telemetry pipeline
    }
  }
