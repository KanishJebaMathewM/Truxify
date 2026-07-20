import express from 'express';
import { supabase, redisClient, createUserClient } from '../config/db.js';
import { getDriverReputation } from '../services/reputation.js';
import { predictDriverProfit } from '../services/ml.js';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { userLimiter, createStore } from '../middleware/rateLimiter.js';

import { validateBody, validateParams } from '../middleware/validate.js';
import { driverOnlineSchema, withdrawSchema, uuidParamSchema, paramIdSchema, predictDriverProfitSchema, uuidSchema } from '../validation/requestSchemas.js';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import logger from '../middleware/logger.js';
const router = express.Router();

// Driver role authorization guard middleware
function requireDriverRole(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required for driver access' });
  }
  if (req.user.role !== 'driver' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Driver role required', role: req.user.role });
  }
  next();
}

function parseIntegerQuery(value) {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(String(value))) return NaN;
  return Number.parseInt(value, 10);
}


// ============================================================================
// 1. GET DRIVER STATS (DRIVER)
// ============================================================================
router.get('/stats', authenticate, userLimiter, requirePolicy('driver:view-stats'), async (req, res) => {
  try {
    const { data: details, error } = await supabase
      .from('driver_details')
      .select('rating, total_trips, completion_rate, is_online, wallet_confirmed, wallet_pending, wallet_total, truck_id')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch driver stats.', details: error.message });
    }

    if (!details) {
      return res.status(404).json({ error: 'Driver statistics profile not initialized.' });
    }

    // Fetch truck details if assigned
    let truck = null;
    if (details.truck_id) {
      const { data: truckData } = await supabase
        .from('trucks')
        .select('*')
        .eq('id', details.truck_id)
        .maybeSingle();
      truck = truckData;
    }

    res.json({
      stats: details,
      truck
    });

  } catch (err) {
    logger.error('Driver stats fetch error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 2. TOGGLE ONLINE / OFFLINE STATUS (DRIVER)
// ============================================================================
router.put('/online', authenticate, userLimiter, requirePolicy('driver:toggle-online'), validateBody(driverOnlineSchema), async (req, res) => {
  const { is_online } = req.body;

  try {
    const { data: details, error } = await supabase
      .from('driver_details')
      .update({ is_online, updated_at: new Date().toISOString() })
      .eq('user_id', req.user.id)
      .select('is_online')
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: 'Failed to update online state.', details: error.message });
    }
    if (!details) {
      return res.status(404).json({ error: 'Driver profile not found.' });
    }

    res.json({
      message: `Driver status marked as ${is_online ? 'online' : 'offline'}.`,
      is_online: details.is_online
    });

  } catch (err) {
    logger.error('Driver online status update error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 3. FETCH WALLET TRANSACTION HISTORY (DRIVER)
// ============================================================================
router.get('/wallet/history', authenticate, userLimiter, requirePolicy('driver:view-wallet'), async (req, res) => {
  try {
    const page = parseIntegerQuery(req.query.page) ?? 1;
    const limit = parseIntegerQuery(req.query.limit) ?? 20;

    // Validation
    if (isNaN(page) || page < 1) {
      return res.status(400).json({
        error: 'page must be greater than or equal to 1'
      });
    }

    if (isNaN(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({
        error: 'limit must be between 1 and 100'
      });
    }

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const {
      data: transactions,
      error,
      count
    } = await supabase
      .from('wallet_transactions')
      .select('*', { count: 'exact' })
      .eq('driver_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      return res.status(500).json({
        error: 'Failed to fetch transaction history.',
        details: error.message
      });
    }

    res.json({
      page,
      limit,
      total: count || 0,
      totalPages: Math.ceil((count || 0) / limit),
      transactions: transactions || []
    });

  } catch (err) {
    logger.error('Wallet history fetch error:', err);

    res.status(500).json({
      error: 'Internal Server Error'
    });
  }
});

// ============================================================================
// 4. FETCH Aggregated daily/weekly earnings summaries for chart (DRIVER)
// ============================================================================
router.get('/earnings/summary', authenticate, userLimiter, requirePolicy('driver:view-earnings'), async (req, res) => {
  const daysParam = req.query.days ?? '30';
  const limitDays = typeof daysParam === 'string' ? Number(daysParam) : NaN;

  if (!Number.isInteger(limitDays) || limitDays < 1 || limitDays > 365) {
    return res.status(400).json({
      error: 'days must be an integer between 1 and 365'
    });
  }

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (limitDays - 1));

    const { data: summary, error } = await supabase
      .from('earnings_daily')
      .select('day_date, amount, trip_count, hours_driven')
      .eq('driver_id', req.user.id)
      .gte('day_date', cutoff.toISOString().split('T')[0])
      .order('day_date', { ascending: true });

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch earnings summary.', details: error.message });
    }

    res.json(summary || []);

  } catch (err) {
    logger.error('Driver earnings summary fetch error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 5. FETCH DRIVER TRIPS (DRIVER)
// ============================================================================
router.get('/trips', authenticate, userLimiter, requirePolicy('driver:view-trips'), async (req, res) => {
  const { status } = req.query;
  const rawPage = req.query.page;
  const rawLimit = req.query.limit;
  const parsedPage = parseIntegerQuery(rawPage);
  const parsedLimit = parseIntegerQuery(rawLimit);
  if (rawPage !== undefined && (!Number.isInteger(parsedPage) || parsedPage < 1)) {
    return res.status(400).json({ error: 'page must be a positive integer' });
  }
  if (rawLimit !== undefined && (!Number.isInteger(parsedLimit) || parsedLimit < 1)) {
    return res.status(400).json({ error: 'limit must be a positive integer' });
  }
  const page = parsedPage || 1;
  const limit = Math.min(100, Math.max(1, parsedLimit || 10));

  try {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from('trips')
      .select('*', { count: 'exact' })
      .eq('driver_id', req.user.id);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: trips, error, count } = await query.order('trip_date', { ascending: false }).range(from, to);

    if (error) return res.status(500).json({ error: 'Failed to fetch trips.', details: error.message });
    res.json({
      page,
      limit,
      total: count || 0,
      totalPages: Math.ceil((count || 0) / limit),
      trips: trips || []
    });
  } catch (err) {
    logger.error('Driver trips fetch error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 6. FETCH TRIP ITEMS (DRIVER)
// ============================================================================
router.get('/trips/:tripDisplayId/items', authenticate, userLimiter, requirePolicy('driver:view-trip-items'), async (req, res) => {
  const { tripDisplayId } = req.params;

  try {
    const { data: trip } = await supabase.from('trips').select('id').eq('trip_display_id', tripDisplayId).eq('driver_id', req.user.id).maybeSingle();
    if (!trip) return res.status(403).json({ error: 'Access Denied: Trip does not belong to you.' });

    const { data: items, error } = await supabase.from('trip_items').select('*').eq('trip_display_id', tripDisplayId);

    if (error) return res.status(500).json({ error: 'Failed to fetch trip items.', details: error.message });
    res.json(items || []);
  } catch (err) {
    logger.error('Driver trip items fetch error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 7. FETCH TRIP STOPS (DRIVER)
// ============================================================================
router.get('/trips/:tripDisplayId/stops', authenticate, userLimiter, requirePolicy('driver:view-trip-stops'), async (req, res) => {
  const { tripDisplayId } = req.params;

  try {
    const { data: trip } = await supabase.from('trips').select('id').eq('trip_display_id', tripDisplayId).eq('driver_id', req.user.id).maybeSingle();
    if (!trip) return res.status(403).json({ error: 'Access Denied: Trip does not belong to you.' });

    const { data: stops, error } = await supabase.from('trip_stops').select('*').eq('trip_display_id', tripDisplayId).order('sort_order', { ascending: true });

    if (error) return res.status(500).json({ error: 'Failed to fetch trip stops.', details: error.message });
    res.json(stops || []);
  } catch (err) {
    logger.error('Driver trip stops fetch error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 8. FETCH ROUTE MAP POINTS (DRIVER)
// ============================================================================
router.get('/trips/:tripDisplayId/route-points', authenticate, userLimiter, requirePolicy('driver:view-route-points'), async (req, res) => {
  const { tripDisplayId } = req.params;

  try {
    const { data: trip } = await supabase.from('trips').select('id').eq('trip_display_id', tripDisplayId).eq('driver_id', req.user.id).maybeSingle();
    if (!trip) return res.status(403).json({ error: 'Access Denied: Trip does not belong to you.' });

    const { data: points, error } = await supabase.from('route_map_points').select('*').eq('trip_display_id', tripDisplayId).order('sort_order', { ascending: true });

    if (error) return res.status(500).json({ error: 'Failed to fetch route points.', details: error.message });
    res.json(points || []);
  } catch (err) {
    logger.error('Driver route points fetch error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 8b. TOGGLE ROUTE MAP POINT CLAIMED (DRIVER)
// ============================================================================
router.patch(
  '/route-points/:id/claim',
  authenticate,
  userLimiter,
  requirePolicy('driver:claim-route-point'),
  validateParams(paramIdSchema),
  async (req, res) => {
    const { id } = req.params;
    const claimed = req.body?.claimed;

    if (typeof claimed !== 'boolean') {
      return res.status(400).json({ error: 'claimed must be a boolean' });
    }

    try {
      const { data: point, error: pointError } = await supabase
        .from('route_map_points')
        .select('id, trip_display_id')
        .eq('id', id)
        .maybeSingle();

      if (pointError) {
        return res.status(500).json({ error: 'Failed to fetch route point.', details: pointError.message });
      }
      if (!point) {
        return res.status(404).json({ error: 'Route map point not found.' });
      }

      const { data: trip } = await supabase
        .from('trips')
        .select('id')
        .eq('trip_display_id', point.trip_display_id)
        .eq('driver_id', req.user.id)
        .maybeSingle();

      if (!trip) {
        return res.status(403).json({ error: 'Access Denied: Route point does not belong to your trip.' });
      }

      const { data: updated, error: updateError } = await supabase
        .from('route_map_points')
        .update({ claimed })
        .eq('id', id)
        .select('*')
        .maybeSingle();

      if (updateError) {
        return res.status(500).json({ error: 'Failed to update route point.', details: updateError.message });
      }

      res.json({ point: updated });
    } catch (err) {
      logger.error('Driver route point claim error:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },
);

// ============================================================================
// 9. FETCH DRIVER BIDS (DRIVER)
// ============================================================================
router.get('/bids', authenticate, userLimiter, requirePolicy('driver:view-bids'), async (req, res) => {
  try {
    const pageParam = req.query.page ?? '1';
    const limitParam = req.query.limit ?? '10';
    const page = typeof pageParam === 'string' ? Number(pageParam) : NaN;
    const limit = typeof limitParam === 'string' ? Number(limitParam) : NaN;

    if (!Number.isInteger(page) || page < 1) {
      return res.status(400).json({ error: 'page must be greater than or equal to 1' });
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({ error: 'limit must be between 1 and 100' });
    }

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: bids, error, count } = await supabase
      .from('load_bids')
      .select('*', { count: 'exact' })
      .eq('driver_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) return res.status(500).json({ error: 'Failed to fetch bids.', details: error.message });
    res.json({
      page,
      limit,
      total: count || 0,
      totalPages: Math.ceil((count || 0) / limit),
      bids: bids || []
    });
  } catch (err) {
    logger.error('Driver bids fetch error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 10. WITHDRAW FUNDS FROM WALLET (DRIVER)
// ============================================================================
router.post('/wallet/withdraw', authenticate, userLimiter, requirePolicy('driver:withdraw'), validateBody(withdrawSchema), async (req, res) => {
  const { amount } = req.body; // in paisa

  try {
    // 5.1 Fetch driver confirmed balance
    const { data: details, error: detailsErr } = await supabase
      .from('driver_details')
      .select('wallet_confirmed')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (detailsErr || !details) {
      return res.status(404).json({ error: 'Driver profile details not found.' });
    }

    if (details.wallet_confirmed < amount) {
      return res.status(400).json({ 
        error: 'Insufficient confirmed balance.', 
        available: details.wallet_confirmed,
        requested: amount
      });
    }

    // 5.2 Execute atomically via Supabase RPC
    const userClient = req.token ? createUserClient(req.token) : supabase;
    const { error: rpcErr } = await userClient.rpc('withdraw_funds_tx', {
      p_driver_id: req.user.id,
      p_amount:    amount
    });

    if (rpcErr) {
      return res.status(400).json({
        error: rpcErr.message.includes('Insufficient')
          ? 'Insufficient confirmed balance.'
          : 'Withdrawal failed.',
        details: rpcErr.message
      });
    }

    res.status(200).json({
      message: 'Withdrawal request initiated successfully.'
    });

  } catch (err) {
    logger.error('Driver wallet withdrawal error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 10b. ML-POWERED PROFIT PREDICTION (DRIVER)
// ============================================================================
const predictProfitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many prediction requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post(
  '/predict-profit',
  authenticate,
  predictProfitLimiter,
  requirePolicy('driver:view-stats'),
  validateBody(predictDriverProfitSchema),
  async (req, res) => {
    try {
      const {
        route_distance_km,
        fuel_price_per_litre,
        toll_estimate_inr,
        truck_mileage_kml,
        cargo_weight_kg,
        trip_duration_hours,
      } = req.body;

      const result = await predictDriverProfit({
        routeDistanceKm: route_distance_km,
        fuelPricePerLitre: fuel_price_per_litre,
        tollEstimateInr: toll_estimate_inr,
        truckMileageKmL: truck_mileage_kml,
        cargoWeightKg: cargo_weight_kg,
        tripDurationHours: trip_duration_hours,
      });

      res.json({ prediction: result });
    } catch (err) {
      if (err.message?.includes('[ML]')) {
        logger.warn({ err: err.message }, 'ML engine unavailable for profit prediction');
        return res.status(503).json({ error: 'Profit prediction service is temporarily unavailable.' });
      }
      logger.error({ err }, 'Profit prediction failed');
      res.status(500).json({ error: 'Profit prediction failed.' });
    }
  },
);

// ============================================================================
// 11. GET DRIVER REPUTATION (DRIVER)
// ============================================================================
router.get('/:driverId/reputation', authenticate, userLimiter, requirePolicy('driver:view-reputation'), validateParams(z.object({ driverId: uuidSchema })), async (req, res) => {
  const { driverId } = req.params;

  if (driverId !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {

    // Check cache in Redis first if client exists
    if (redisClient) {
      try {
        const cached = await redisClient.get(`driver-reputation:${driverId}`);
        if (cached) {
          logger.info(`[reputation] Cache hit for driver ${driverId}`);
          return res.status(200).json(JSON.parse(cached));
        }
      } catch (cacheErr) {
        logger.error(`[reputation] Redis read error for driver ${driverId}: ${cacheErr.message}`);
      }
    }

    // Fetch details from Supabase
    const { data: details, error } = await supabase
      .from('driver_details')
      .select('rating, polygon_wallet_address')
      .eq('user_id', driverId)
      .maybeSingle();

    if (error) {
      logger.error(`[reputation] Supabase query error for driver ${driverId}: ${error.message}`);
      return res.status(500).json({ error: 'Failed to fetch driver details.', details: error.message });
    }

    if (!details) {
      return res.status(404).json({ error: 'Driver not found.' });
    }

    const walletAddress = details.polygon_wallet_address ?? null;
    let onChainScore = null;

    if (walletAddress) {
      onChainScore = await getDriverReputation(walletAddress);
    }

    const responseData = {
      driverId,
      walletAddress,
      onChainScore,
      supabaseRating: details.rating
    };

    // Cache the response in Redis for 30 seconds
    if (redisClient) {
      try {
        await redisClient.set(
          `driver-reputation:${driverId}`,
          JSON.stringify(responseData),
          'EX',
          30
        );
      } catch (cacheErr) {
        logger.error(`[reputation] Redis write error for driver ${driverId}: ${cacheErr.message}`);
      }
    }

    return res.status(200).json(responseData);

  } catch (err) {
    logger.error(`[reputation] Unexpected error retrieving reputation for driver ${driverId}: ${err.message}`);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;

// Resolves #2051: Composite indexes added for 2dsphere queries
