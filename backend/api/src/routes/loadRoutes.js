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
import { supabaseAdmin } from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import logger from '../middleware/logger.js';
import { loadFilterQuerySchema, createLoadSchema } from '../validation/loadSchemas.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import { paramIdSchema, uuidParamSchema } from '../validation/requestSchemas.js';
import { escapeLike } from '../lib/escapeLike.js';
import { invalidateBookingCaches } from '../utils/cacheInvalidation.js';


const router = express.Router();

// Explicit allow-list for the driver-facing marketplace. Excludes internal
// columns such as customer_id so drivers never see the freight owner's
// identity and any future sensitive column is not auto-disclosed.
const MARKETPLACE_COLUMNS =
  'id, order_display_id, customer_name, company_name, route_label, route_subtitle, pickup_address, pickup_lat, pickup_lng, drop_address, drop_lat, drop_lng, route_distance, route_duration, goods_type, weight, dimensions, is_stackable, is_fragile, special_handling, freight_value, fuel_cost, toll_cost, net_profit, capacity_used, truck_fill_label, space_available, badge_label, badge_emoji, is_best_profit, is_en_route, extra_distance_km, extra_earnings, route_note, distance_from_driver, status, created_at, updated_at';


// Sanitize load filter query params to prevent injection attacks
function sanitizeLoadFilters(query) {
  const allowed = ['min_price', 'max_price', 'distance', 'goods_type', 'weight', 'origin', 'destination', 'page', 'limit'];
  const sanitized = {};
  for (const key of Object.keys(query)) {
    if (allowed.includes(key)) {
      sanitized[key] = query[key];
    }
  }
  return sanitized;
}

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
      .select(MARKETPLACE_COLUMNS, { count: 'exact' });

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
      const destination = (Array.isArray(req.query.destination) ? req.query.destination[0] : req.query.destination).trim();
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

    let finalLoads = loads || [];

    // RECOMMENDATION ENGINE (Only on page 1)
    if (page === 1 && req.user && req.user.id) {
      try {
        // 1. Fetch driver's historical context
        const { data: pastOrders } = await supabaseAdmin
          .from('orders')
          .select('pickup_address, drop_address, goods_type, freight_value')
          .eq('driver_id', req.user.id)
          .order('created_at', { ascending: false })
          .limit(20);

        const { data: driverProfile } = await supabaseAdmin
          .from('driver_details')
          .select('rating, vehicle_type')
          .eq('user_id', req.user.id)
          .maybeSingle();

        if (pastOrders && pastOrders.length > 0 && driverProfile) {
          const pickupFreq = {};
          const dropFreq = {};
          const goodsFreq = {};
          let totalValue = 0;

          pastOrders.forEach(order => {
            const pickLoc = order.pickup_address ? order.pickup_address.split(',')[0].trim() : '';
            const dropLoc = order.drop_address ? order.drop_address.split(',')[0].trim() : '';
            if (pickLoc) pickupFreq[pickLoc] = (pickupFreq[pickLoc] || 0) + 1;
            if (dropLoc) dropFreq[dropLoc] = (dropFreq[dropLoc] || 0) + 1;
            if (order.goods_type) goodsFreq[order.goods_type] = (goodsFreq[order.goods_type] || 0) + 1;
            totalValue += (order.freight_value || 0);
          });

          const avgValue = totalValue / pastOrders.length;
          const ratingBoost = (driverProfile.rating || 0) * 0.5;

          // Score available loads
          finalLoads.forEach(load => {
            let score = 0;
            const pickLoc = load.pickup_address ? load.pickup_address.split(',')[0].trim() : '';
            const dropLoc = load.drop_address ? load.drop_address.split(',')[0].trim() : '';

            if (pickupFreq[pickLoc]) score += pickupFreq[pickLoc] * 2;
            if (dropFreq[dropLoc]) score += dropFreq[dropLoc] * 2;
            if (load.goods_type && goodsFreq[load.goods_type]) score += goodsFreq[load.goods_type] * 3;
            if (load.freight_value >= avgValue * 0.8) score += 2;
            
            score += ratingBoost;
            load._recommendation_score = score;
          });

          const scoredLoads = finalLoads.filter(l => l._recommendation_score > ratingBoost); // must have some match besides rating
          scoredLoads.sort((a, b) => b._recommendation_score - a._recommendation_score);

          const topRecommended = scoredLoads.slice(0, 3);
          const topIds = new Set(topRecommended.map(l => l.id));

          topRecommended.forEach(l => {
            l.is_recommended = true;
            delete l._recommendation_score;
          });

          const rest = finalLoads.filter(l => !topIds.has(l.id));
          rest.forEach(l => delete l._recommendation_score);

          finalLoads = [...topRecommended, ...rest];
        }
      } catch (recError) {
        logger.error('Error computing recommendations:', recError);
      }
    }

    // Map fields for client compatibility
    const formattedLoads = finalLoads.map(load => ({
      ...load,
      pickup: load.pickup_address,
      destination: load.drop_address,
      estimated_price: load.freight_value / 100, // freight_value stored in paisa — divide by 100 for INR display
      vehicle_type: 'Truck'
    }));

    res.json({
      page,
      limit,
      total: count || 0,
      totalPages: Math.ceil((count || 0) / limit),
      loads: formattedLoads
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
      .select(MARKETPLACE_COLUMNS)
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

