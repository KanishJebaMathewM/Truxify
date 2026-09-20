import express from 'express';
import { createUserClient } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import logger from '../middleware/logger.js';
import { predictDemand } from '../services/ml.js';
import { demandConfig } from '../config/demand.js';
import { LoadOfferCacheService } from '../services/order/loadOfferCacheService.js';

const router = express.Router();
const buildDemandZones = (loads, maxZones = 50) => {
  const regions = new Map();

  for (const load of loads || []) {
    const rawLat = load.pickup_lat;
    const rawLng = load.pickup_lng;

    if (rawLat === null || rawLat === undefined || String(rawLat).trim() === '' ||
        rawLng === null || rawLng === undefined || String(rawLng).trim() === '') {
      continue;
    }

    const lat = Number(rawLat);
    const lng = Number(rawLng);

    if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
        !Number.isFinite(lng) || lng < -180 || lng > 180) {
      continue;
    }

    const region = LoadOfferCacheService.getRegion(lat, lng);
    if (region === 'global') continue;

    const existing = regions.get(region);
    if (existing) {
      existing.count += 1;
      existing.latSum += lat;
      existing.lngSum += lng;
    } else {
      regions.set(region, {
        count: 1,
        latSum: lat,
        lngSum: lng,
        address: load.pickup_address,
        status: load.status,
      });
    }
  }

  const zones = [...regions.entries()]
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, maxZones);

  const maxCount = zones[0]?.[1].count || 1;

  return zones.map(([region, data]) => ({
    region,
    count: data.count,
    lat: data.latSum / data.count,
    lng: data.lngSum / data.count,
    intensity: Number((data.count / maxCount).toFixed(2)),
    label: data.address || `Demand Zone ${region}`,
    status: data.status,
  }));
};


// ============================================================================
// 1. GET DEMAND HEATMAP
// GET /api/demand-heatmap
// ============================================================================
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
      logger.error(
          {
              requestId: req.requestId,
              event: 'DEMAND_HEATMAP_FETCH_ERROR',
              error
          },
          'Failed to fetch historical volume for heatmap'
      );
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
      logger.warn(
        {
            requestId: req.requestId,
            event: 'ML_ENGINE_PREDICTION_FAILED',
            mlErr
        },
        'ML engine prediction failed, falling back to basic data'
    );
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

    // 3. Construct GeoJSON from geographically aggregated demand zones.
    const demandZones = buildDemandZones(filteredLoads);

    const features = demandZones.map((zone) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [zone.lng, zone.lat]
      },
      properties: {
        intensity: zone.intensity,
        demand_count: zone.count,
        region: zone.region,
        status: zone.status,
        address: zone.label
      }
    }));

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
    logger.error(
        {
            requestId: req.requestId,
            event: 'DEMAND_HEATMAP_INTERNAL_ERROR',
            error: err
        },
        'Internal Server Error in GET /api/demand-heatmap'
    );
    return res.status(500).json({ error: 'Internal Server Error' });
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


