import express from 'express';
import { supabase } from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { validateParams, validateBody } from '../middleware/validate.js';
import { paramIdSchema, uuidParamSchema, registerTruckSchema } from '../validation/requestSchemas.js';
import { getRouteEstimate } from '../services/osrm.js';
import { computeOrderPricing } from '../lib/pricing.js';
import { predictPrice } from '../services/ml.js';
import logger from '../middleware/logger.js';

const router = express.Router();

// ============================================================================
// REGISTER A TRUCK (DRIVER ONLY)
// ============================================================================
/**
 * @route POST /api/trucks
 * @desc Allows authenticated drivers to register a truck they own.
 * @access Driver
 * @param {string} req.body.name - Name of the truck
 * @param {string} req.body.number_plate - Number plate of the truck (normalised to uppercase)
 * @param {number} req.body.max_capacity_tons - Maximum capacity of the truck in tons
 * @returns {object} 201 - Successfully registered truck details
 * @returns {object} 400 - Validation errors
 * @returns {object} 403 - Forbidden for non-drivers
 * @returns {object} 409 - Truck with number plate already registered
 * @returns {object} 500 - Internal server error
 */
router.post('/', authenticate, requireRole(['driver']), userLimiter, validateBody(registerTruckSchema), async (req, res) => {
  const { name, number_plate, max_capacity_tons } = req.body;

  try {
    // Check for duplicate number plate
    const { data: existing, error: checkErr } = await supabase
      .from('trucks')
      .select('id')
      .eq('number_plate', number_plate)
      .maybeSingle();

    if (checkErr) {
      return res.status(500).json({ error: 'Failed to check for existing truck.', details: checkErr.message });
    }

    if (existing) {
      return res.status(409).json({ error: 'A truck with this number plate is already registered.' });
    }

    const { data: truck, error: insertErr } = await supabase
      .from('trucks')
      .insert({ name, number_plate, max_capacity_tons, owner_id: req.user.id })
      .select('id, name, number_plate, max_capacity_tons, created_at')
      .single();

    if (insertErr) {
      if (insertErr.code === '23505') {
        return res.status(409).json({ error: 'A truck with this number plate is already registered.' });
      }
      return res.status(500).json({ error: 'Failed to register truck.', details: insertErr.message });
    }

    return res.status(201).json({ message: 'Truck registered successfully.', truck });
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// ============================================================================
// LIST DRIVER'S TRUCKS
// ============================================================================
/**
 * @route GET /api/trucks
 * @desc Returns all trucks owned by the authenticated driver.
 * @access Driver
 * @param {string} [req.query.name] - Filter trucks by name (case-insensitive substring)
 * @param {number} [req.query.min_capacity] - Minimum capacity filter in tons
 * @param {number} [req.query.max_capacity] - Maximum capacity filter in tons
 * @returns {object} 200 - Array of trucks
 * @returns {object} 403 - Forbidden for non-drivers
 * @returns {object} 500 - Internal server error
 */
router.get('/', authenticate, requireRole(['driver']), userLimiter, async (req, res) => {
  const { name } = req.query;
  const { min_capacity, max_capacity } = req.query;

  try {
    let query = supabase
      .from('trucks')
      .select('id, name, number_plate, max_capacity_tons, created_at')
      .eq('owner_id', req.user.id);

    if (name) {
      query = query.ilike('name', `%${name}%`);
    }
    if (min_capacity) {
      query = query.gte('max_capacity_tons', Number(min_capacity));
    }
    if (max_capacity) {
      query = query.lte('max_capacity_tons', Number(max_capacity));
    }

    const { data: trucks, error } = await query.order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch trucks.', details: error.message });
    }

    return res.json({ trucks: trucks || [] });
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});


function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes'].includes(String(value).trim().toLowerCase());
}

/**
 * @route GET /api/trucks/search
 * @desc Search for online drivers with active trucks and calculate price estimates
 * @access Authenticated
 * @param {number} req.query.pickup_lat - Pickup latitude
 * @param {number} req.query.pickup_lng - Pickup longitude
 * @param {number} req.query.drop_lat - Drop-off latitude
 * @param {number} req.query.drop_lng - Drop-off longitude
 * @param {number} req.query.weight_tonnes - Cargo weight in tonnes
 * @param {boolean} [req.query.is_fragile] - Fragile cargo indicator
 * @param {boolean} [req.query.is_stackable] - Stackable cargo indicator
 * @returns {array} 200 - List of matching drivers and their price/ETA estimates
 * @returns {object} 400 - Validation errors or missing/invalid query parameters
 * @returns {object} 500 - Internal server error
 */
router.get('/search', authenticate, userLimiter, async (req, res) => {
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

  if (numPickupLat < -90 || numPickupLat > 90 || numDropLat < -90 || numDropLat > 90) {
    return res.status(400).json({ error: 'Latitude must be between -90 and 90' });
  }
  if (numPickupLng < -180 || numPickupLng > 180 || numDropLng < -180 || numDropLng > 180) {
    return res.status(400).json({ error: 'Longitude must be between -180 and 180' });
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

    let finalBaseFreight = pricing.baseFreight;
    let finalTollEstimate = pricing.tollEstimate;
    let finalPlatformFee = pricing.platformFee;
    let finalTotalAmount = pricing.totalAmount;
    let isAiEstimate = false;

    try {
      const mlResult = await predictPrice({
        distanceKm: pricing.distanceKm,
        cargoWeightKg: numWeightTonnes * 1000,
        truckType: 'medium_truck',
      });
      if (mlResult && typeof mlResult.estimated_price === 'number' && mlResult.estimated_price > 0) {
        const estimatedPrice = Math.round(mlResult.estimated_price * 100);
        finalTotalAmount = estimatedPrice;
        finalPlatformFee = Math.round(estimatedPrice * 0.05);
        finalBaseFreight = estimatedPrice - finalPlatformFee - finalTollEstimate;
        if (finalBaseFreight < 0) {
          finalBaseFreight = 0;
          finalTollEstimate = estimatedPrice - finalPlatformFee;
        }
        isAiEstimate = true;
      } else {
        logger.warn({ mlResult }, 'Invalid price prediction response during search');
      }
    } catch (mlErr) {
      logger.warn({ err: mlErr.message }, 'Price prediction unavailable during search, falling back to base pricing');
    }

    const { data: drivers, error: driversErr } = await supabase
      .from('driver_details')
      .select('user_id, rating, total_trips, completion_rate, truck_id')
      .eq('is_online', true)
      .not('truck_id', 'is', null);

    if (driversErr) {
      logger.error('Driver search error:', driversErr.message);
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
        price: finalTotalAmount,
        baseFreight: finalBaseFreight,
        tollEstimate: finalTollEstimate,
        platformFee: finalPlatformFee,
        isAiEstimate,
        etaMinutes,
      };
    });

    res.json(results);
  } catch (err) {
    logger.error('Truck search error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * @route GET /api/trucks/:id/number
 * @desc Retrieve the number plate of a truck by its UUID
 * @access Authenticated
 * @param {string} req.params.id - The UUID of the truck
 * @returns {object} 200 - Truck number plate
 * @returns {object} 400 - Invalid UUID format
 * @returns {object} 404 - Truck not found
 * @returns {object} 500 - Internal server error
 */
router.get('/:id/number', authenticate, userLimiter, validateParams(uuidParamSchema), async (req, res) => {
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
