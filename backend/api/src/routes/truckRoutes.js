import express from 'express';
import { supabase, mongoDb } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { validateParams, validateBody } from '../middleware/validate.js';
import { uuidParamSchema, registerTruckSchema } from '../validation/requestSchemas.js';
import { getRouteEstimate } from '../services/osrm.js';
import { computeOrderPricing } from '../lib/pricing.js';
import { predictPrice } from '../services/ml.js';
import logger from '../middleware/logger.js';

function sanitizeNumberPlate(plate) {
  if (!plate || typeof plate !== 'string') return '';
  return plate.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function sanitizeTruckName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.trim().slice(0, 100)
    .replace(/[<>]/g, '')
    .replace(/script/gi, '')
    .replace(/javascript/gi, '')
    .replace(/on\w+=/gi, '');
}

function validateCapacity(capacity) {
  const num = Number(capacity);
  return Number.isFinite(num) && num > 0 && num <= 100 ? num : null;
}

const router = express.Router();

// GET /api/trucks/types
router.get('/types', authenticate, userLimiter, (req, res) => {
  return res.json({
    types: ['Open Body', 'Closed Body', 'Container', 'Refrigerated']
  });
});
function parseCapacityFilter(value, field) {
  if (value === undefined) return { value: undefined };
  if (typeof value !== 'string' || value.trim() === '') {
    return { error: `${field} must be a non-negative number` };
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { error: `${field} must be a non-negative number` };
  }

  return { value: parsed };
}

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
router.post('/', authenticate, requirePolicy('truck:register'), userLimiter, validateBody(registerTruckSchema), async (req, res) => {
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
router.get('/', authenticate, requirePolicy('truck:list-own'), userLimiter, async (req, res) => {
  const { name, min_capacity, max_capacity } = req.query;

  try {
    const minCapacity = parseCapacityFilter(min_capacity, 'min_capacity');
    if (minCapacity.error) {
      return res.status(400).json({ error: minCapacity.error });
    }

    const maxCapacity = parseCapacityFilter(max_capacity, 'max_capacity');
    if (maxCapacity.error) {
      return res.status(400).json({ error: maxCapacity.error });
    }

    if (
      minCapacity.value !== undefined &&
      maxCapacity.value !== undefined &&
      minCapacity.value > maxCapacity.value
    ) {
      return res.status(400).json({ error: 'min_capacity must be less than or equal to max_capacity' });
    }

    let query = supabase
      .from('trucks')
      .select('id, name, number_plate, max_capacity_tons, created_at')
      .eq('owner_id', req.user.id);

    if (name && typeof name === 'string') {
      const cleanName = name.trim();
      if (cleanName) {
        query = query.ilike('name', `%${cleanName}%`);
      }
    }

    if (minCapacity.value !== undefined) {
      query = query.gte('max_capacity_tons', minCapacity.value);
    }

    if (maxCapacity.value !== undefined) {
      query = query.lte('max_capacity_tons', maxCapacity.value);
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
  if (value === undefined) return { value: false };
  if (typeof value === 'boolean') return { value };
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return { value: true };
  if (['false', '0', 'no'].includes(normalized)) return { value: false };
  return { error: 'Boolean filters must be true or false' };
}

function isLatitude(value) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isLongitude(value) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

router.get('/search', authenticate, userLimiter, async (req, res) => {
  const {
    pickup_lat, pickup_lng,
    drop_lat, drop_lng,
    weight_tonnes,
    is_fragile, is_stackable,
    truck_type, min_capacity, max_capacity, material_type
  } = req.query;

  if (pickup_lat == null || pickup_lng == null || drop_lat == null || drop_lng == null || weight_tonnes == null) {
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

  if (!isLatitude(numPickupLat) || !isLatitude(numDropLat) || !isLongitude(numPickupLng) || !isLongitude(numDropLng)) {
    return res.status(400).json({ error: 'Latitude must be between -90 and 90 and longitude must be between -180 and 180' });
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
  const fragileFilter = parseBoolean(is_fragile);
  if (fragileFilter.error) {
    return res.status(400).json({ error: fragileFilter.error });
  }
  const stackableFilter = parseBoolean(is_stackable);
  if (stackableFilter.error) {
    return res.status(400).json({ error: stackableFilter.error });
  }

  const VALID_TRUCK_TYPES = ['Open Body', 'Closed Body', 'Container', 'Refrigerated'];
  if (truck_type !== undefined && truck_type !== '') {
    if (!VALID_TRUCK_TYPES.includes(truck_type)) {
      return res.status(400).json({ error: `Invalid truck_type. Must be one of: ${VALID_TRUCK_TYPES.join(', ')}` });
    }
  }

  const VALID_MATERIAL_TYPES = ['Textile', 'Electronics', 'Food', 'Machinery', 'Furniture'];
  if (material_type !== undefined && material_type !== '') {
    if (!VALID_MATERIAL_TYPES.includes(material_type)) {
      return res.status(400).json({ error: `Invalid material_type. Must be one of: ${VALID_MATERIAL_TYPES.join(', ')}` });
    }
  }

  const minCapFilter = parseCapacityFilter(min_capacity, 'min_capacity');
  if (minCapFilter.error) {
    return res.status(400).json({ error: minCapFilter.error });
  }

  const maxCapFilter = parseCapacityFilter(max_capacity, 'max_capacity');
  if (maxCapFilter.error) {
    return res.status(400).json({ error: maxCapFilter.error });
  }

  if (minCapFilter.value !== undefined && maxCapFilter.value !== undefined && minCapFilter.value > maxCapFilter.value) {
    return res.status(400).json({ error: 'min_capacity must be less than or equal to max_capacity' });
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
      isFragile: fragileFilter.value,
      isStackable: stackableFilter.value,
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
      if (mlResult && mlResult.estimatedPricePaisa > 0) {
        finalTotalAmount = mlResult.estimatedPricePaisa;
        finalPlatformFee = Math.round(mlResult.estimatedPricePaisa * 0.05);
        finalBaseFreight = Math.max(0, mlResult.estimatedPricePaisa - finalPlatformFee - finalTollEstimate);
        if (finalBaseFreight === 0) {
          finalTollEstimate = Math.max(0, mlResult.estimatedPricePaisa - finalPlatformFee);
        }
        isAiEstimate = true;
      } else {
        logger.warn({ mlResult }, 'Invalid price prediction response during search');
      }
    } catch (mlErr) {
      logger.warn({ err: mlErr.message }, 'Price prediction unavailable during search, falling back to base pricing');
    }

    let nearbyDriverIds = [];
    if (mongoDb) {
      try {
        const maxDistanceMeters = 50000; // 50km radius
        const nearbyTelemetry = await mongoDb.collection('telemetry').find({
          location: {
            $near: {
              $geometry: {
                type: "Point",
                coordinates: [numPickupLng, numPickupLat]
              },
              $maxDistance: maxDistanceMeters
            }
          }
        }).toArray();

        nearbyDriverIds = [...new Set(nearbyTelemetry.map(t => t.driver_id))];
      } catch (mongoErr) {
        logger.error('MongoDB telemetry search error:', mongoErr.message);
      }
    }

    if (nearbyDriverIds.length === 0) {
      return res.json([]);
    }

    const { data: drivers, error: driversErr } = await supabase
      .from('driver_details')
      .select('user_id, rating, total_trips, completion_rate, truck_id')
      .eq('is_online', true)
      .not('truck_id', 'is', null)
      .in('user_id', nearbyDriverIds);

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
        capacityTons: truck.max_capacity_tons || 0,
        price: finalTotalAmount,
        baseFreight: finalBaseFreight,
        tollEstimate: finalTollEstimate,
        platformFee: finalPlatformFee,
        isAiEstimate,
        etaMinutes,
      };
    });

    const filteredResults = results.filter(truck => {
      if (minCapFilter.value !== undefined && truck.capacityTons < minCapFilter.value) {
        return false;
      }
      if (maxCapFilter.value !== undefined && truck.capacityTons > maxCapFilter.value) {
        return false;
      }
      if (truck_type && truck_type !== '') {
        const truckNameLower = (truck.truck || '').toLowerCase();
        const typeLower = truck_type.toLowerCase();
        if (!truckNameLower.includes(typeLower)) {
          return false;
        }
      }
      return true;
    });

    const responseResults = filteredResults.map(({ capacityTons, ...rest }) => rest);

    res.json(responseResults);
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

// Resolves #2053: Prevent race conditions in truck allocation
