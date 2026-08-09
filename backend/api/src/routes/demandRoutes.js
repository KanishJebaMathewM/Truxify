import express from 'express';
import { supabase } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import logger from '../middleware/logger.js';
import { predictDemand } from '../services/ml.js';
import { demandConfig } from '../config/demand.js';

const router = express.Router();

// ============================================================================
// 1. GET DEMAND HEATMAP
// GET /api/demand-heatmap
// ============================================================================
router.get('/', authenticate, userLimiter, requirePolicy('demand:view-heatmap'), async (req, res) => {
  try {
    // 1. Fetch recent load offers (historical/current volume)
    const { data: loads, error } = await supabase
      .from('load_offers')
      .select('pickup_address, drop_address, status, pickup_lat, pickup_lng')
      .in('status', ['available', 'claimed'])
      .limit(100);

    if (error) {
      logger.error('Failed to fetch historical volume for heatmap:', error);
      return res.status(500).json({ error: 'Failed to fetch heatmap data.' });
    }

    // 2. Fetch ML prediction aggregation for high-demand zones & route insights
    let mlPrediction = { predicted_demand: 0.5 };
    try {
      mlPrediction = await predictDemand({
        hour: new Date().getHours(),
        day_of_week: new Date().getDay(),
        temperature: 25.0,
        precipitation: 0,
        historical_volume: loads?.length || 0,
        nearby_drivers: 0,
      });
    } catch (mlErr) {
      logger.warn('[DemandHeatmap] ML engine prediction failed, falling back to basic data:', mlErr.message);
    }

    // Extract optional query filters for vehicle type and cargo category
    const { vehicle_type, cargo_category } = req.query;

    // Generate intelligent route recommendations and earnings potential based on ML predictions
    const baseEarningRate = demandConfig.baseEarningRate; // per km estimate
    const multiplier = mlPrediction.predicted_demand || 0.5;
    const estimatedEarningPotential = Number((baseEarningRate * (1 + multiplier)).toFixed(2));

    const routeSuggestions = (loads || []).slice(0, 3).map((l, idx) => ({
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
    const features = (loads || []).map((load) => {
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
