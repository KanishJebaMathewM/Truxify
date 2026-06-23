import express from 'express';
import { supabase } from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import logger from '../middleware/logger.js';

const router = express.Router();

// ============================================================================
// 1. GET ALL AVAILABLE LOAD OFFERS (DRIVER)
// GET /api/loads
// ============================================================================
router.get('/', authenticate, userLimiter, requireRole(['driver']), async (req, res) => {
  try {
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
    if (req.query.vehicle_type && req.query.vehicle_type.toLowerCase() !== 'truck') {
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

    // Status filter - map 'open'/'available' to the DB's status 'available'
    let statusFilter = 'available';
    if (req.query.status) {
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
      query = query.ilike('pickup_address', `%${req.query.pickup_location}%`);
    }
    if (req.query.destination) {
      query = query.ilike('drop_address', `%${req.query.destination}%`);
    }
    if (req.query.goods_type) {
      query = query.eq('goods_type', req.query.goods_type);
    }
    if (req.query.min_price) {
      const min = parseFloat(req.query.min_price);
      if (isNaN(min) || min < 0) return res.status(400).json({ error: 'min_price must be a non-negative number' });
      // Map min_price (in Rupees) to freight_value (in paisa)
      query = query.gte('freight_value', Math.round(min * 100));
    }
    if (req.query.max_price) {
      const max = parseFloat(req.query.max_price);
      if (isNaN(max) || max < 0) return res.status(400).json({ error: 'max_price must be a non-negative number' });
      // Map max_price (in Rupees) to freight_value (in paisa)
      query = query.lte('freight_value', Math.round(max * 100));
    }
    if (req.query.distance) {
      const maxDistance = parseFloat(req.query.distance);
      if (isNaN(maxDistance) || maxDistance < 0) return res.status(400).json({ error: 'distance must be a non-negative number' });
      query = query.lte('extra_distance_km', maxDistance);
    }

    // Sorting
    const validSortFields = ['estimated_price', 'created_at', 'distance'];
    const sortByParam = validSortFields.includes(req.query.sort_by) ? req.query.sort_by : 'created_at';
    
    // Map sort fields to database columns
    let sortBy = 'created_at';
    if (sortByParam === 'estimated_price') {
      sortBy = 'freight_value';
    } else if (sortByParam === 'distance') {
      sortBy = 'extra_distance_km';
    }

    const ascending = req.query.order === 'asc';

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
router.get('/:id', authenticate, userLimiter, requireRole(['driver']), async (req, res) => {
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