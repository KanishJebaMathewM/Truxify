import express from 'express';
import { supabase } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import logger from '../middleware/logger.js';
import { loadFilterQuerySchema } from '../validation/loadSchemas.js';
import { validateParams } from '../middleware/validate.js';
import { paramIdSchema, uuidParamSchema } from '../validation/requestSchemas.js';
import { escapeLike } from '../lib/escapeLike.js';


const router = express.Router();


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
router.get('/', authenticate, userLimiter, requirePolicy('load-offer:browse'), async (req, res) => {
  try {
    const filterResult = loadFilterQuerySchema.safeParse(req.query);
    if (!filterResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: filterResult.error.issues.map(issue => ({
          field: issue.path.join('.') || 'query',
          message: issue.message,
        })),
      });
    }
    const filters = filterResult.data;

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

    let query = supabase
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

    query = query.order(sortBy, { ascending }).range(from, to);

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
      estimated_price: load.freight_value / 100, // convert paisa to Rupees
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
// 2. GET SINGLE LOAD OFFER BY ID (DRIVER)
// GET /api/loads/:id
// ============================================================================
router.get('/:id', authenticate, userLimiter, requirePolicy('load-offer:browse'), validateParams(paramIdSchema), async (req, res) => {
  try {
    const { data: load, error } = await supabase
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
      estimated_price: load.freight_value / 100, // convert paisa to Rupees
      vehicle_type: 'Truck'
    };

    res.json({ load: formattedLoad });

  } catch (err) {
    logger.error('Internal Server Error in GET /api/loads/:id:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;

