/**
 * @openapi
 * components:
 *   schemas:
 *     DriverStats:
 *       type: object
 *       properties:
 *         stats:
 *           type: object
 *           properties:
 *             rating:
 *               type: number
 *             total_trips:
 *               type: integer
 *             completion_rate:
 *               type: number
 *             is_online:
 *               type: boolean
 *             wallet_confirmed:
 *               type: number
 *             wallet_pending:
 *               type: number
 *             wallet_total:
 *               type: number
 *         truck:
 *           type: object
 *           nullable: true
 *     DriverOnlineRequest:
 *       type: object
 *       required:
 *         - is_online
 *       properties:
 *         is_online:
 *           type: boolean
 *     DriverOnlineResponse:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *         is_online:
 *           type: boolean
 *     WalletHistoryResponse:
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
 *         transactions:
 *           type: array
 *           items:
 *             type: object
 *     EarningsSummaryResponse:
 *       type: array
 *       items:
 *         type: object
 *         properties:
 *           day_date:
 *             type: string
 *             format: date
 *           amount:
 *             type: number
 *           trip_count:
 *             type: integer
 *           hours_driven:
 *             type: number
 *     DriverTripsResponse:
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
 *         trips:
 *           type: array
 *           items:
 *             type: object
 *     BidListResponse:
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
 *         bids:
 *           type: array
 *           items:
 *             type: object
 *     WithdrawRequest:
 *       type: object
 *       required:
 *         - amount
 *       properties:
 *         amount:
 *           type: number
 *           description: Amount in paisa
 *     WithdrawResponse:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *     DriverReputationResponse:
 *       type: object
 *       properties:
 *         driverId:
 *           type: string
 *         walletAddress:
 *           type: string
 *           nullable: true
 *         onChainScore:
 *           type: number
 *           nullable: true
 *         supabaseRating:
 *           type: number
 */

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
/**
 * @openapi
 * /api/driver/stats:
 *   get:
 *     tags: [Driver]
 *     summary: Get driver statistics
 *     description: Returns driver's rating, trip counts, wallet balances, and assigned truck details. Driver role required.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Driver statistics
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DriverStats'
 *       404:
 *         description: Driver profile not initialized
 */
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
/**
 * @openapi
 * /api/driver/online:
 *   put:
 *     tags: [Driver]
 *     summary: Toggle driver online/offline status
 *     description: Updates the driver's availability status for receiving load offers.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DriverOnlineRequest'
 *     responses:
 *       200:
 *         description: Status updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DriverOnlineResponse'
 *       400:
 *         description: Validation error
 */
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
/**
 * @openapi
 * /api/driver/wallet/history:
 *   get:
 *     tags: [Driver]
 *     summary: Get wallet transaction history
 *     description: Returns paginated wallet transaction history for the authenticated driver.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *         description: Items per page
 *     responses:
 *       200:
 *         description: Transaction history
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WalletHistoryResponse'
 *       400:
 *         description: Invalid pagination parameters
 */
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
/**
 * @openapi
 * /api/driver/earnings/summary:
 *   get:
 *     tags: [Driver]
 *     summary: Get earnings summary for charts
 *     description: Returns aggregated daily earnings data for the specified number of days (max 365).
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 30
 *           minimum: 1
 *           maximum: 365
 *         description: Number of days to include
 *     responses:
 *       200:
 *         description: Earnings data array
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EarningsSummaryResponse'
 *       400:
 *         description: Invalid days parameter
 */
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
/**
 * @openapi
 * /api/driver/trips:
 *   get:
 *     tags: [Driver]
 *     summary: List driver trips
 *     description: Returns paginated trips for the authenticated driver, optionally filtered by status.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by trip status
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
 *     responses:
 *       200:
 *         description: Paginated trip list
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DriverTripsResponse'
 */
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
/**
 * @openapi
 * /api/driver/trips/{tripDisplayId}/items:
 *   get:
 *     tags: [Driver]
 *     summary: Get trip items
 *     description: Returns all items for a specific trip. Driver must own the trip.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tripDisplayId
 *         required: true
 *         schema:
 *           type: string
 *         description: Trip display ID
 *     responses:
 *       200:
 *         description: Array of trip items
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       403:
 *         description: Access denied
 */
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
/**
 * @openapi
 * /api/driver/trips/{tripDisplayId}/stops:
 *   get:
 *     tags: [Driver]
 *     summary: Get trip stops
 *     description: Returns all stops for a specific trip, ordered by sort_order. Driver must own the trip.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tripDisplayId
 *         required: true
 *         schema:
 *           type: string
 *         description: Trip display ID
 *     responses:
 *       200:
 *         description: Array of trip stops
 *       403:
 *         description: Access denied
 */
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
/**
 * @openapi
 * /api/driver/trips/{tripDisplayId}/route-points:
 *   get:
 *     tags: [Driver]
 *     summary: Get route map points
 *     description: Returns route geometry points for a trip's map display. Driver must own the trip.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tripDisplayId
 *         required: true
 *         schema:
 *           type: string
 *         description: Trip display ID
 *     responses:
 *       200:
 *         description: Array of route map points
 *       403:
 *         description: Access denied
 */
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
/**
 * @openapi
 * /api/driver/bids:
 *   get:
 *     tags: [Driver]
 *     summary: List driver's bids
 *     description: Returns paginated bid history for the authenticated driver.
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
 *     responses:
 *       200:
 *         description: Paginated bid list
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BidListResponse'
 */
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
/**
 * @openapi
 * /api/driver/wallet/withdraw:
 *   post:
 *     tags: [Driver]
 *     summary: Withdraw funds from wallet
 *     description: Initiates a withdrawal from the driver's confirmed wallet balance. Amount is in paisa. Uses Supabase RPC for atomic transaction.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WithdrawRequest'
 *     responses:
 *       200:
 *         description: Withdrawal initiated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WithdrawResponse'
 *       400:
 *         description: Insufficient balance or validation error
 */
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
/**
 * @openapi
 * /api/driver/{driverId}/reputation:
 *   get:
 *     tags: [Driver]
 *     summary: Get driver reputation
 *     description: Returns driver's on-chain reputation score from Polygon and off-chain rating from Supabase. Results are cached in Redis for 30 seconds.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Driver's UUID
 *     responses:
 *       200:
 *         description: Driver reputation data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DriverReputationResponse'
 *       403:
 *         description: Forbidden - can only view own reputation
 *       404:
 *         description: Driver not found
 */
router.get('/:driverId/reputation', authenticate, userLimiter, requirePolicy('driver:view-reputation'), validateParams(uuidParamSchema), async (req, res) => {
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


router.get('/weigh-stations/bypass-status', requireAuth, requireDriverRole, async (req, res) => {
  try {
    const driverId = req.user.id;
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const status = await checkBypassEligibility(driverId, lat, lng);
    return res.status(200).json(status);
  } catch (err) {
    logger.error(`[weigh-station] Error getting bypass status for driver ${req.user.id}: ${err.message}`);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;

// Resolves #2051: Composite indexes added for 2dsphere queries
