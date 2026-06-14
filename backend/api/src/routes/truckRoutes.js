import express from 'express';
import { supabase } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { getRouteEstimate } from '../services/osrm.js';
import { computeOrderPricing } from '../lib/pricing.js';

const router = express.Router();

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes'].includes(String(value).trim().toLowerCase());
}

router.get('/search', authenticate, async (req, res) => {
  const {
    pickup_lat, pickup_lng,
    drop_lat, drop_lng,
    weight_tonnes,
    is_fragile, is_stackable
  } = req.query;

  if (!pickup_lat || !pickup_lng || !drop_lat || !drop_lng || !weight_tonnes) {
    return res.status(400).json({ error: 'Missing required query parameters: pickup_lat, pickup_lng, drop_lat, drop_lng, weight_tonnes' });
  }

  const numPickupLat = Number(pickup_lat);
  const numPickupLng = Number(pickup_lng);
  const numDropLat = Number(drop_lat);
  const numDropLng = Number(drop_lng);
  const numWeightTonnes = Number(weight_tonnes);

  if ([numPickupLat, numPickupLng, numDropLat, numDropLng, numWeightTonnes].some(isNaN)) {
    return res.status(400).json({ error: 'Invalid numeric parameters' });
  }

  if (numWeightTonnes <= 0 || numWeightTonnes > 50) {
    return res.status(400).json({ error: 'Weight must be between 0 and 50 tonnes' });
  }

  try {
    const routeEstimate = await getRouteEstimate({
      pickupLat: numPickupLat,
      pickupLng: numPickupLng,
      dropLat: numDropLat,
      dropLng: numDropLng,
    });

    const pricing = computeOrderPricing({
      pickupLat: numPickupLat,
      pickupLng: numPickupLng,
      dropLat: numDropLat,
      dropLng: numDropLng,
      weightTonnes: numWeightTonnes,
      roadDistanceKm: routeEstimate?.distanceKm,
      isFragile: parseBoolean(is_fragile),
      isStackable: parseBoolean(is_stackable),
    });

    const { data: drivers, error: driversErr } = await supabase
      .from('driver_details')
      .select('user_id, rating, total_trips, completion_rate, truck_id')
      .eq('is_online', true)
      .not('truck_id', 'is', null);

    if (driversErr) {
      console.error('Driver search error:', driversErr.message);
      return res.status(500).json({ error: 'Failed to search trucks. Please try again later.' });
    }

    if (!drivers || drivers.length === 0) {
      return res.json([]);
    }

    const truckIds = drivers.map(d => d.truck_id).filter(Boolean);
    const driverIds = drivers.map(d => d.user_id);

    const [trucksRes, profilesRes] = await Promise.all([
      supabase.from('trucks').select('id, name, number_plate, max_capacity_tons').in('id', truckIds),
      supabase.from('profiles').select('id, full_name, avatar_url').in('id', driverIds),
    ]);

    const truckMap = Object.fromEntries((trucksRes.data || []).map(t => [t.id, t]));
    const profileMap = Object.fromEntries((profilesRes.data || []).map(p => [p.id, p]));

    const etaMinutes = routeEstimate?.durationSeconds
      ? Math.round(routeEstimate.durationSeconds / 60)
      : null;

    const results = drivers.map(d => {
      const profile = profileMap[d.user_id] || {};
      const truck = truckMap[d.truck_id] || {};
      return {
        driver: profile.full_name || 'Unknown Driver',
        driverId: d.user_id,
        rating: d.rating || 0,
        truck: truck.name || 'Unknown Truck',
        truckNumber: truck.number_plate || '',
        capacity: truck.max_capacity_tons ? `${truck.max_capacity_tons} tonnes` : '',
        price: pricing.totalAmount,
        etaMinutes,
      };
    });

    res.json(results);
  } catch (err) {
    console.error('Truck search error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET TRUCK NUMBER PLATE BY ID
router.get('/:id/number', authenticate, async (req, res) => {
  try {
    const { data: truck, error } = await supabase
      .from('trucks')
      .select('number_plate')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) return res.status(500).json({ error: 'Failed to fetch truck number.', details: error.message });
    if (!truck) return res.status(404).json({ error: 'Truck not found.' });

    res.json({ number_plate: truck.number_plate });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
