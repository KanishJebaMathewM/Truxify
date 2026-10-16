/**
 * @openapi
 * components:
 *   schemas:
 *     LoadOffer:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         pickup_address:
 *           type: string
 *         drop_address:
 *           type: string
 *         freight_value:
 *           type: number
 *         goods_type:
 *           type: string
 *         status:
 *           type: string
 *           enum: [available, claimed, expired, cancelled]
 *         pickup:
 *           type: string
 *         destination:
 *           type: string
 *         estimated_price:
 *           type: number
 *         vehicle_type:
 *           type: string
 *     LoadListResponse:
 *       type: object
 *       properties:
 *         page:
 *           type: integer
 *         limit:
 *           type: integer
 *         total:
 *           type: integer
 *         totalPages:
 *           type: integer
 *         loads:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/LoadOffer'
 *     LoadSingleResponse:
 *       type: object
 *       properties:
 *         load:
 *           $ref: '#/components/schemas/LoadOffer'
 */

import express from 'express';
import { supabaseAdmin, redisClient } from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import logger from '../middleware/logger.js';
import { loadFilterQuerySchema, createLoadSchema } from '../validation/loadSchemas.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import { paramIdSchema } from '../validation/requestSchemas.js';
import { escapeLike } from '../lib/escapeLike.js';
import { invalidateBookingCaches } from '../utils/cacheInvalidation.js';
// backend/api/src/routes/loadRoutes.js

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import logger from '../middleware/logger.js';
import supabaseAdmin from '../config/supabase.js';

const router = express.Router();

/**
 * Helper to validate latitude and longitude ranges.
 */
function isValidCoordinate(lat, lng) {
  const numLat = Number(lat);
  const numLng = Number(lng);
  return (
    Number.isFinite(numLat) &&
    Number.isFinite(numLng) &&
    numLat >= -90 && numLat <= 90 &&
    numLng >= -180 && numLng <= 180
  );
}

/**
 * GET /api/loads
 * Retrieves available loads with strict validation on query filters.
 * Fixed per issue #9833.
 */
router.get('/loads', authenticate, async (req, res) => {
  try {
    const { min_price, max_price, distance, page = '1', limit = '20' } = req.query;

    // FIX: Validate and parse pagination
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({ success: false, error: 'Invalid pagination parameters' });
    }

    let query = supabaseAdmin.from('loads').select('*');

    // FIX: Validate min_price and max_price
    if (min_price !== undefined) {
      const minPriceNum = parseFloat(min_price);
      if (!Number.isFinite(minPriceNum) || minPriceNum < 0) {
        return res.status(400).json({ success: false, error: 'Invalid min_price parameter' });
      }
      query = query.gte('freight_value', Math.round(minPriceNum * 100));
    }

    if (max_price !== undefined) {
      const maxPriceNum = parseFloat(max_price);
      if (!Number.isFinite(maxPriceNum) || maxPriceNum < 0) {
        return res.status(400).json({ success: false, error: 'Invalid max_price parameter' });
      }
      query = query.lte('freight_value', Math.round(maxPriceNum * 100));
    }

    // FIX: Validate distance filter
    if (distance !== undefined) {
      const distanceNum = parseFloat(distance);
      if (!Number.isFinite(distanceNum) || distanceNum < 0) {
        return res.status(400).json({ success: false, error: 'Invalid distance parameter' });
      }
      query = query.or(`extra_distance_km.is.null,extra_distance_km.lte.${distanceNum}`);
    }

    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;
    const { data: loads, error: loadErr } = await query.range(from, to);

    if (loadErr) {
      logger.error('Database error fetching loads', { error: loadErr.message });
      return res.status(500).json({ success: false, error: 'Internal server error while fetching loads' });
    }

    return res.status(200).json({ success: true, data: loads });
  } catch (err) {
    logger.error('Exception in GET /api/loads', { error: err.message, stack: err.stack });
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/loads
 * Creates a new load offer with rigorous coordinate and pricing validation.
 * Fixed per issue #9833.
 */
router.post('/loads', authenticate, async (req, res) => {
  try {
    const { origin, destination, weight_tons, expected_price } = req.body;

    // FIX: Validate origin and destination coordinates
    if (!origin || !isValidCoordinate(origin.lat, origin.lng)) {
      return res.status(400).json({ success: false, error: 'Invalid or missing origin coordinates (lat [-90,90], lng [-180,180])' });
    }
    if (!destination || !isValidCoordinate(destination.lat, destination.lng)) {
      return res.status(400).json({ success: false, error: 'Invalid or missing destination coordinates' });
    }

    // FIX: Validate weight_tons (> 0)
    const weightNum = parseFloat(weight_tons);
    if (!Number.isFinite(weightNum) || weightNum <= 0) {
      return res.status(400).json({ success: false, error: 'Weight must be a positive number greater than 0' });
    }

    // FIX: Validate expected_price (> 0)
    const priceNum = parseFloat(expected_price);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      return res.status(400).json({ success: false, error: 'Expected price must be a positive number greater than 0' });
    }

    const freightValuePaisa = Math.round(priceNum * 100);

    const { data: newLoad, error: insertErr } = await supabaseAdmin
      .from('loads')
      .insert({
        customer_id: req.user.id,
        pickup_lat: origin.lat,
        pickup_lng: origin.lng,
        drop_lat: destination.lat,
        drop_lng: destination.lng,
        weight_tons: weightNum,
        freight_value: freightValuePaisa,
        status: 'open',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (insertErr) {
      logger.error('Failed to insert new load offer', { error: insertErr.message });
      return res.status(500).json({ success: false, error: 'Failed to create load offer' });
    }

    logger.info('Load offer created successfully', { loadId: newLoad.id });
    return res.status(201).json({ success: true, data: newLoad });
  } catch (err) {
    logger.error('Exception in POST /api/loads', { error: err.message, stack: err.stack });
    return res.status(500).json({ success: false, error: 'Internal server error while creating load' });
  }
});

export default router;

const router = express.Router();

// ============================================================================
// 1. GET ALL AVAILABLE LOAD OFFERS (DRIVER)
// GET /api/loads
// ============================================================================
/**
 * @openapi
 * /api/loads:
 *   get:
 *     tags: [Loads]
 *     summary: List available load offers
 *     description: Returns paginated load offers for drivers. Supports filtering by status, location, price range, goods type, and distance. Results sorted by specified field.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 100
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [open, available, claimed, expired, cancelled]
 *       - in: query
 *         name: pickup_location
 *         schema:
 *           type: string
 *       - in: query
 *         name: destination
 *         schema:
 *           type: string
 *       - in: query
 *         name: goods_type
 *         schema:
 *           type: string
 *       - in: query
 *         name: min_price
 *         schema:
 *           type: number
 *         description: Minimum price in Rupees
 *       - in: query
 *         name: max_price
 *         schema:
 *           type: number
 *         description: Maximum price in Rupees
 *       - in: query
 *         name: sort_by
 *         schema:
 *           type: string
 *           enum: [estimated_price, created_at, distance]
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *     responses:
 *       200:
 *         description: Paginated load offers
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoadListResponse'
 *       400:
 *         description: Validation error
 */
router.get('/', authenticate, userLimiter, requirePolicy('load-offer:browse'), validateQuery(loadFilterQuerySchema), async (req, res) => {
  try {
    const filters = req.query;

    const pageVal = req.query.page || '1';
    const limitVal = req.query.limit || '10';

    // Strict validation for pagination values (only digits allowed, no truncation/coercion)
    if (!/^\d+$/.test(String(pageVal))) {
      return res.status(400).json({ error: 'page must be a valid integer' });
    }
    if (!/^\d+$/.test(String(limitVal))) {
      return res.status(400).json({ error: 'limit must be a valid integer' });
    }

    const page = parseInt(pageVal, 10);
    const limit = parseInt(limitVal, 10);

    if (page < 1) {
      return res.status(400).json({ error: 'page must be greater than or equal to 1' });
    }
    if (limit < 1 || limit > 100) {
      return res.status(400).json({ error: 'limit must be between 1 and 100' });
    }

    // Handle vehicle_type filtering in JS to avoid database column errors.
    // Default mapped vehicle_type is 'Truck'. If they filter by something else, return empty.
    if (req.query.vehicle_type && typeof req.query.vehicle_type !== 'string') {
      return res.status(400).json({ error: 'vehicle_type must be a single string' });
    }
    const vehicleType = req.query.vehicle_type || '';
    if (vehicleType && vehicleType.toLowerCase() !== 'truck') {
      return res.json({
        page,
        limit,
        total: 0,
        totalPages: 0,
        loads: []
      });
    }

    const from = (page - 1) * limit;
    const to   = from + limit - 1;

    // load_offers is RLS-protected with all anon privileges revoked, so the
    // marketplace board must read through the service-role client.
    let query = supabaseAdmin
      .from('load_offers')
      .select('*', { count: 'exact' });

    let statusFilter = 'available';
    if (req.query.status) {
      if (typeof req.query.status !== 'string') {
        return res.status(400).json({ error: 'status must be a single string, not an array or object' });
      }
      const statusLower = req.query.status.toLowerCase();
      if (statusLower === 'open' || statusLower === 'available') {
        statusFilter = 'available';
      } else {
        const allowedStatuses = ['available', 'claimed', 'expired', 'cancelled'];
        if (allowedStatuses.includes(statusLower)) {
          statusFilter = statusLower;
        } else {
          return res.status(400).json({ error: 'status must be one of: open, available, claimed, expired, cancelled' });
        }
      }
    }
    query = query.eq('status', statusFilter);

    // Filters
    if (req.query.pickup_location) {
      const pickupLocation = (Array.isArray(req.query.pickup_location) ? req.query.pickup_location[0] : req.query.pickup_location).trim();
      if (!pickupLocation) {
        return res.status(400).json({ error: 'pickup_location must not be empty' });
      }
      if (pickupLocation.length > 200) {
        return res.status(400).json({ error: 'pickup_location too long (max 200 chars)' });
      }
      query = query.ilike('pickup_address', `%${escapeLike(pickupLocation)}%`);
    }
    if (req.query.destination) {
      if (Array.isArray(req.query.destination)) {
        return res.status(400).json({ error: 'Repeated destination parameters are not allowed' });
      }
      if (typeof req.query.destination !== 'string') {
        return res.status(400).json({ error: 'destination must be a string' });
      }
      const destination = req.query.destination.trim();
      if (!destination) {
        return res.status(400).json({ error: 'destination must not be empty' });
      }
      if (destination.length > 200) {
        return res.status(400).json({ error: 'destination too long (max 200 chars)' });
      }
      query = query.ilike('drop_address', `%${escapeLike(destination)}%`);
    }
    if (req.query.goods_type) {
      if (typeof req.query.goods_type !== 'string') {
        return res.status(400).json({ error: 'goods_type must be a single string' });
      }
      const goodsType = req.query.goods_type.trim();
      if (!goodsType) {
        return res.status(400).json({ error: 'goods_type must not be empty' });
      }
      query = query.eq('goods_type', goodsType);
    }
    if (filters.min_price !== undefined) {
      // Map min_price (in Rupees) to freight_value (in paisa)
      query = query.gte('freight_value', Math.round(filters.min_price * 100));
    }
    if (filters.max_price !== undefined) {
      // Map max_price (in Rupees) to freight_value (in paisa)
      query = query.lte('freight_value', Math.round(filters.max_price * 100));
    }
    if (filters.distance !== undefined) {
      // Include NULL extra_distance_km rows: most load offers are not
      // en-route opportunities and leave this column NULL, so a plain
      // .lte() would silently drop them (see issue #1943).
      query = query.or(`extra_distance_km.is.null,extra_distance_km.lte.${filters.distance}`);
    }

    // Sorting
    const sortByParam = filters.sort_by || 'created_at';
    
    // Map sort fields to database columns
    let sortBy = 'created_at';
    if (sortByParam === 'estimated_price') {
      sortBy = 'freight_value';
    } else if (sortByParam === 'distance') {
      sortBy = 'extra_distance_km';
    }

    const ascending = filters.order === 'asc';

    // Add an id tie-breaker (same direction) so pagination stays stable when
    // multiple rows share the same sort key. The composite index
    // (status, created_at DESC, id DESC) satisfies this ordering from the
    // index alone, with no sort node.
    query = query.order(sortBy, { ascending });
    if (sortBy !== 'id') {
      query = query.order('id', { ascending });
    }
    query = query.range(from, to);

    const { data: loads, error, count } = await query;

    if (error) {
      logger.error('Failed to fetch load offers:', error);
      return res.status(500).json({ error: 'Failed to fetch load offers.' });
    }

    // Map fields for client compatibility
    const formattedLoads = (loads || []).map(load => ({
      ...load,
      pickup: load.pickup_address,
      destination: load.drop_address,
      estimated_price: load.freight_value / 100, // freight_value stored in paisa — divide by 100 for INR display
      vehicle_type: 'Truck'
    }));

    const totalCount = count || 0;
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page * limit < totalCount;

    res.json({
      success: true,
      page,
      limit,
      total: totalCount,
      totalPages,
      hasNextPage,
      loads: formattedLoads,
      data: formattedLoads,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages,
        hasNextPage,
      }
    });

  } catch (err) {
    logger.error('Internal Server Error in GET /api/loads:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 1.5 CREATE NEW LOAD OFFER (CUSTOMER)
// POST /api/loads
// ============================================================================
router.post('/', authenticate, userLimiter, requireRole(['customer']), validateBody(createLoadSchema), async (req, res) => {
  try {
    const { origin, destination, weight_tons, expected_price, material_type } = req.body;

    const pickupAddress = origin.address || 'Unknown Origin';
    const dropAddress = destination.address || 'Unknown Destination';
    const routeLabel = `${pickupAddress.split(',')[0]} \u2192 ${dropAddress.split(',')[0]}`;

    const { data, error } = await supabaseAdmin
      .from('load_offers')
      .insert({
        customer_id: req.user.id,
        customer_name: req.user.fullName || 'Customer',
        pickup_address: pickupAddress,
        drop_address: dropAddress,
        pickup_lat: origin.lat,
        pickup_lng: origin.lng,
        drop_lat: destination.lat,
        drop_lng: destination.lng,
        route_label: routeLabel,
        weight: `${weight_tons} tonnes`,
        freight_value: Math.round(parseFloat(expected_price) * 100), // user input in INR — multiply by 100 to store as paisa
        goods_type: material_type || 'General',
        status: 'available'
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create load offer:', error);
      return res.status(500).json({ error: 'Failed to create load offer', details: error.message });
    }

    // Invalidate caches since a new load is posted
    invalidateBookingCaches().catch(err => logger.error({ err }, 'Failed to invalidate cache on load creation'));

    res.status(201).json({ message: 'Load posted successfully', load: data });
  } catch (err) {
    logger.error('Internal Server Error in POST /api/loads:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 1.8 GET LOAD STATISTICS (DRIVER)
// GET /api/loads/stats
// ============================================================================
/**
 * @openapi
 * /api/loads/stats:
 *   get:
 *     tags: [Loads]
 *     summary: Get aggregate load metrics
 *     description: Returns aggregate marketplace load statistics including active loads, average/min/max freight price, average distance, and nearby loads. Cached for 60 seconds.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: vehicleType
 *         schema:
 *           type: string
 *         description: Optional vehicle type filter (e.g., mini_truck, truck)
 *     responses:
 *       200:
 *         description: Aggregate load statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 vehicleType:
 *                   type: string
 *                 activeLoads:
 *                   type: integer
 *                 avgFreightPrice:
 *                   type: number
 *                 minFreightPrice:
 *                   type: number
 *                 maxFreightPrice:
 *                   type: number
 *                 avgDistance:
 *                   type: number
 *                 nearbyLoads:
 *                   type: integer
 *                 lastUpdated:
 *                   type: string
 */
router.get('/stats', authenticate, userLimiter, requirePolicy('load-offer:browse'), async (req, res) => {
  const vehicleType = req.query.vehicleType || req.query.vehicle_type || null;

  if (vehicleType && typeof vehicleType !== 'string') {
    return res.status(400).json({ error: 'vehicleType must be a string' });
  }

  const normalizedVehicle = vehicleType ? vehicleType.trim() : null;
  const cacheKey = `loads:stats:${normalizedVehicle ? normalizedVehicle.toLowerCase() : 'all'}`;

  // Check Redis cache (60s TTL)
  if (redisClient) {
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        return res.json({ success: true, ...parsed });
      }
    } catch (cacheErr) {
      logger.warn({ err: cacheErr.message }, 'Failed to read load stats from Redis cache');
    }
  }

  try {
    let statsData = null;

    // 1. Try Supabase RPC get_load_stats
    if (supabaseAdmin && typeof supabaseAdmin.rpc === 'function') {
      const { data, error } = await supabaseAdmin.rpc('get_load_stats', {
        p_vehicle_type: normalizedVehicle,
      });

      if (!error && data) {
        statsData = typeof data === 'string' ? JSON.parse(data) : data;
      }
    }

    // 2. Fallback to direct DB query if RPC is not available or failed
    if (!statsData) {
      let query = supabaseAdmin
        .from('load_offers')
        .select('freight_value, extra_distance_km')
        .eq('status', 'available');

      const { data: rows, error } = await query;

      if (error) {
        logger.error('Failed to fetch load stats from DB:', error);
        return res.status(500).json({ error: 'Failed to fetch load statistics' });
      }

      const activeLoads = rows ? rows.length : 0;
      let sumFreight = 0;
      let minFreight = activeLoads > 0 ? Infinity : 0;
      let maxFreight = 0;
      let sumDistance = 0;
      let distanceCount = 0;
      let nearbyLoads = 0;

      for (const row of rows || []) {
        const valInr = (Number(row.freight_value) || 0) / 100;
        sumFreight += valInr;
        if (valInr < minFreight) minFreight = valInr;
        if (valInr > maxFreight) maxFreight = valInr;

        if (row.extra_distance_km !== null && row.extra_distance_km !== undefined) {
          const dist = Number(row.extra_distance_km) || 0;
          sumDistance += dist;
          distanceCount++;
          if (dist <= 50) nearbyLoads++;
        } else {
          nearbyLoads++;
        }
      }

      statsData = {
        vehicleType: normalizedVehicle || 'all',
        activeLoads,
        avgFreightPrice: activeLoads > 0 ? Number((sumFreight / activeLoads).toFixed(2)) : 0,
        minFreightPrice: minFreight === Infinity ? 0 : minFreight,
        maxFreightPrice: maxFreight,
        avgDistance: distanceCount > 0 ? Number((sumDistance / distanceCount).toFixed(2)) : 0,
        nearbyLoads,
        lastUpdated: new Date().toISOString(),
      };
    }

    // Cache in Redis for 60 seconds
    if (redisClient && statsData) {
      try {
        await redisClient.set(cacheKey, JSON.stringify(statsData), 'EX', 60);
      } catch (cacheSetErr) {
        logger.warn({ err: cacheSetErr.message }, 'Failed to cache load stats in Redis');
      }
    }

    return res.json({ success: true, ...statsData });
  } catch (err) {
    logger.error('Internal Server Error in GET /api/loads/stats:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 2. GET SINGLE LOAD OFFER BY ID (DRIVER)
// GET /api/loads/:id
// ============================================================================
/**
 * @openapi
 * /api/loads/{id}:
 *   get:
 *     tags: [Loads]
 *     summary: Get single load offer
 *     description: Returns details for a specific available load offer by ID.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Load offer UUID
 *     responses:
 *       200:
 *         description: Load offer details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoadSingleResponse'
 *       404:
 *         description: Load offer not found or no longer available
 */
router.get('/:id', authenticate, userLimiter, requirePolicy('load-offer:browse'), validateParams(paramIdSchema), async (req, res) => {
  try {
    const { data: load, error } = await supabaseAdmin
      .from('load_offers')
      .select('*')
      .eq('id', req.params.id)
      .eq('status', 'available')
      .maybeSingle();

    if (error) {
      logger.error('Failed to fetch load offer by ID:', error);
      return res.status(500).json({ error: 'Failed to fetch load offer.' });
    }
    if (!load) {
      return res.status(404).json({ error: 'Load offer not found or no longer available.' });
    }

    // Map fields for client compatibility
    const formattedLoad = {
      ...load,
      pickup: load.pickup_address,
      destination: load.drop_address,
      estimated_price: load.freight_value / 100, // freight_value stored in paisa — divide by 100 for INR display
      vehicle_type: 'Truck'
    };

    res.json({ load: formattedLoad });

  } catch (err) {
    logger.error('Internal Server Error in GET /api/loads/:id:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;

