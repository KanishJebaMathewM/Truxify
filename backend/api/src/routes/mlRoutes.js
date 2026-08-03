import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { supabase } from '../config/db.js';
import { optimiseMidTrip } from '../services/ml.js';
import logger from '../middleware/logger.js';

const router = express.Router();

router.get('/en-route-loads', authenticate, userLimiter, async (req, res) => {
  const driverId = req.query.driverId || req.user.id;
  const currentLat = parseFloat(req.query.currentLat);
  const currentLng = parseFloat(req.query.currentLng);

  try {
    // If coordinates are missing, fallback gracefully to database static en-route loads
    if (isNaN(currentLat) || isNaN(currentLng)) {
      logger.info({ driverId }, '[MLRoutes] Missing coordinates, falling back to static en-route loads');
      const { data: staticLoads, error: staticErr } = await supabase
        .from('load_offers')
        .select('*')
        .eq('is_en_route', true)
        .eq('status', 'available');

      if (staticErr) {
        throw new Error(`Failed to fetch static en-route loads: ${staticErr.message}`);
      }

      return res.json(staticLoads || []);
    }

    // 1. Get driver detail & vehicle capacity
    const { data: driverDetail } = await supabase
      .from('driver_details')
      .select('truck_id')
      .eq('user_id', driverId)
      .maybeSingle();

    let truckSpecs = {
      weight_kg: 5000,
      length_m: 5.0,
      width_m: 2.0,
      height_m: 2.0,
    };

    if (driverDetail?.truck_id) {
      const { data: truck } = await supabase
        .from('trucks')
        .select('max_capacity_tons, cargo_length_ft, cargo_width_ft, cargo_height_ft')
        .eq('id', driverDetail.truck_id)
        .maybeSingle();

      if (truck) {
        truckSpecs = {
          weight_kg: truck.max_capacity_tons ? Number(truck.max_capacity_tons) * 1000 : 5000,
          length_m: truck.cargo_length_ft ? Number(truck.cargo_length_ft) * 0.3048 : 5.0,
          width_m: truck.cargo_width_ft ? Number(truck.cargo_width_ft) * 0.3048 : 2.0,
          height_m: truck.cargo_height_ft ? Number(truck.cargo_height_ft) * 0.3048 : 2.0,
        };
      }
    }

    // 2. Fetch driver's active trip and remaining route points
    const { data: activeTrip } = await supabase
      .from('trips')
      .select('id, trip_display_id')
      .eq('driver_id', driverId)
      .eq('status', 'active')
      .maybeSingle();

    let remainingRoute = [];
    if (activeTrip) {
      const { data: routePoints } = await supabase
        .from('route_map_points')
        .select('latitude, longitude')
        .eq('trip_display_id', activeTrip.trip_display_id)
        .eq('is_claimed', false)
        .order('sort_order', { ascending: true });

      if (routePoints) {
        remainingRoute = routePoints.map((p) => ({
          lat: p.latitude,
          lng: p.longitude,
        }));
      }
    }

    // 3. Fetch all available load offers
    const { data: rawLoads, error: loadsErr } = await supabase
      .from('load_offers')
      .select(`
        id,
        order_display_id,
        pickup_lat,
        pickup_lng,
        drop_lat,
        drop_lng,
        net_profit,
        weight,
        dimensions
      `)
      .eq('status', 'available');

    if (loadsErr) {
      throw new Error(`Failed to fetch load offers: ${loadsErr.message}`);
    }

    // Map/parse loads to match ML input model
    const nearbyLoads = (rawLoads || []).map((load) => {
      let weightKg = 1000;
      if (load.weight) {
        const num = parseFloat(load.weight.replace(/[^\d.]/g, ''));
        if (!isNaN(num)) {
          weightKg = load.weight.toLowerCase().includes('ton') ? num * 1000 : num;
        }
      }

      let lengthM = 3.0;
      let widthM = 1.5;
      let heightM = 1.5;
      if (load.dimensions) {
        const parts = load.dimensions
          .replace(/×/g, 'x')
          .split('x')
          .map((p) => parseFloat(p.trim()));
        if (parts.length >= 3 && !parts.some(isNaN)) {
          const isFeet =
            load.dimensions.toLowerCase().includes('ft') ||
            load.dimensions.toLowerCase().includes('feet');
          const factor = isFeet ? 0.3048 : 1.0;
          lengthM = parts[0] * factor;
          widthM = parts[1] * factor;
          heightM = parts[2] * factor;
        }
      }

      const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      return {
        load_id: load.id,
        pickup_lat: load.pickup_lat,
        pickup_lng: load.pickup_lng,
        dropoff_lat: load.drop_lat,
        dropoff_lng: load.drop_lng,
        weight_kg: weightKg,
        length_m: lengthM,
        width_m: widthM,
        height_m: heightM,
        payment_inr: (load.net_profit || 0) / 100,
        pickup_deadline: deadline,
      };
    });

    // 4. Call ML Service
    const mlResponse = await optimiseMidTrip({
      current_location: { lat: currentLat, lng: currentLng },
      remaining_route: remainingRoute,
      available_capacity: truckSpecs,
      nearby_loads: nearbyLoads,
    });

    const recommendations = mlResponse.recommendations || [];
    const recommendedIds = recommendations.map((r) => r.load_id);

    if (recommendedIds.length === 0) {
      return res.json([]);
    }

    // 5. Query matching load details
    const { data: matchedOffers, error: matchErr } = await supabase
      .from('load_offers')
      .select('*')
      .in('id', recommendedIds);

    if (matchErr) {
      throw new Error(`Failed to load matched offers: ${matchErr.message}`);
    }

    const detourMap = new Map(recommendations.map((r) => [r.load_id, r]));

    const resultOffers = (matchedOffers || []).map((offer) => {
      const rec = detourMap.get(offer.id);
      return {
        ...offer,
        is_en_route: true,
        extra_distance_km: rec ? Math.round(rec.detour_km) : 0,
        extra_earnings: rec ? Math.round(rec.additional_earnings * 100) : 0, // INR to paisa
        route_note: rec
          ? `+${Math.round(rec.detour_km)} km detour (${Math.round(rec.detour_minutes)} mins)`
          : '',
      };
    });

    resultOffers.sort((a, b) => {
      const recA = detourMap.get(a.id);
      const recB = detourMap.get(b.id);
      return (recB?.priority_score || 0) - (recA?.priority_score || 0);
    });

    res.json(resultOffers);
  } catch (err) {
    logger.error({ err }, '[MLRoutes] Failed to optimize en-route loads');
    // Graceful fallback to static loads if ML service fails
    try {
      const { data: staticLoads } = await supabase
        .from('load_offers')
        .select('*')
        .eq('is_en_route', true)
        .eq('status', 'available');
      return res.json(staticLoads || []);
    } catch (fbErr) {
      res.status(500).json({ error: 'Failed to fetch en-route loads.', details: err.message });
    }
  }
});

export default router;
