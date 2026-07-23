import express from 'express';
import { supabase } from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import logger from '../middleware/logger.js';
import { predictDemand } from '../services/ml.js';

const router = express.Router();

// ============================================================================
// 1. GET DEMAND HEATMAP
// GET /api/demand-heatmap
// ============================================================================
router.get('/', authenticate, userLimiter, requireRole(['driver', 'admin']), async (req, res) => {
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

    // 2. Fetch ML prediction aggregation for high-demand zones
    let mlPrediction = { predicted_demand: 0.5 };
    try {
      mlPrediction = await predictDemand({
        hour: new Date().getHours(),
        day_of_week: new Date().getDay(),
        historical_volume: loads?.length || 0
      });
    } catch (mlErr) {
      logger.warn('[DemandHeatmap] ML engine prediction failed, falling back to basic data:', mlErr.message);
    }

    // 3. Construct GeoJSON
    const features = (loads || []).map((load) => {
      const lat = load.pickup_lat;
      const lng = load.pickup_lng;

      if (lat == null || lng == null) {
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

    res.json(geoJson);

  } catch (err) {
    logger.error('Internal Server Error in GET /api/demand-heatmap:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
