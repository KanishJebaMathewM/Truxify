import express from 'express';
import { supabase, redisClient } from '../config/db.js';
import { getDriverReputation } from '../services/reputation.js';
import { authenticate, requireRole } from '../middleware/auth.js';

import { validateBody } from '../middleware/validate.js';
import { driverOnlineSchema, withdrawSchema } from '../validation/requestSchemas.js';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import logger from '../middleware/logger.js';

const router = express.Router();


const loginOtpSchema = z.object({
  phone: z.string().trim().min(10).max(20),
  otp: z.string().regex(/^\d{4}$/, { message: 'OTP must be 4 digits' }),
});

const verifyLoginOtpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many OTP verification attempts. Please try again later.' },
});

router.post('/otp/verify', verifyLoginOtpLimiter, validateBody(loginOtpSchema), async (req, res) => {
  const { phone, otp } = req.body;
  const expectedOtp = (process.env.DRIVER_LOGIN_OTP || '1234').trim();

  if (process.env.NODE_ENV === 'production' && !process.env.DRIVER_LOGIN_OTP) {
    return res.status(503).json({
      error: 'Driver login OTP verification is not configured on this server.',
    });
  }

  if (process.env.DRIVER_LOGIN_PHONE && phone !== process.env.DRIVER_LOGIN_PHONE.trim()) {
    return res.status(400).json({ error: 'Invalid phone number for OTP verification.' });
  }

  if (otp !== expectedOtp) {
    return res.status(400).json({ error: 'Invalid OTP. Please try again.' });
  }

  return res.json({
    message: 'OTP verified successfully.',
    verified: true,
  });
});

// ============================================================================
// 1. GET DRIVER STATS (DRIVER)
// ============================================================================
router.get('/stats', authenticate, requireRole(['driver']), async (req, res) => {
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
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 2. TOGGLE ONLINE / OFFLINE STATUS (DRIVER)
// ============================================================================
router.put('/online', authenticate, requireRole(['driver']), validateBody(driverOnlineSchema), async (req, res) => {
  const { is_online } = req.body;

  if (typeof is_online !== 'boolean') {
    return res.status(400).json({ error: 'Invalid or missing is_online status.' });
  }

  try {
    const { data: details, error } = await supabase
      .from('driver_details')
      .update({ is_online, updated_at: new Date().toISOString() })
      .eq('user_id', req.user.id)
      .select('is_online')
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to update online state.', details: error.message });
    }

    res.json({
      message: `Driver status marked as ${is_online ? 'online' : 'offline'}.`,
      is_online: details.is_online
    });

  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 3. FETCH WALLET TRANSACTION HISTORY (DRIVER)
// ============================================================================
router.get('/wallet/history', authenticate, requireRole(['driver']), async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);

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
router.get('/earnings/summary', authenticate, requireRole(['driver']), async (req, res) => {
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
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 5. FETCH DRIVER TRIPS (DRIVER)
// ============================================================================
router.get('/trips', authenticate, requireRole(['driver']), async (req, res) => {
  const { status } = req.query;

  try {
    let query = supabase
      .from('trips')
      .select('*')
      .eq('driver_id', req.user.id);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: trips, error } = await query.order('trip_date', { ascending: false });

    if (error) return res.status(500).json({ error: 'Failed to fetch trips.', details: error.message });
    res.json(trips || []);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 6. FETCH TRIP ITEMS (DRIVER)
// ============================================================================
router.get('/trips/:tripDisplayId/items', authenticate, requireRole(['driver']), async (req, res) => {
  const { tripDisplayId } = req.params;

  try {
    const { data: trip } = await supabase.from('trips').select('id').eq('trip_display_id', tripDisplayId).eq('driver_id', req.user.id).maybeSingle();
    if (!trip) return res.status(403).json({ error: 'Access Denied: Trip does not belong to you.' });

    const { data: items, error } = await supabase.from('trip_items').select('*').eq('trip_display_id', tripDisplayId);

    if (error) return res.status(500).json({ error: 'Failed to fetch trip items.', details: error.message });
    res.json(items || []);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 7. FETCH TRIP STOPS (DRIVER)
// ============================================================================
router.get('/trips/:tripDisplayId/stops', authenticate, requireRole(['driver']), async (req, res) => {
  const { tripDisplayId } = req.params;

  try {
    const { data: trip } = await supabase.from('trips').select('id').eq('trip_display_id', tripDisplayId).eq('driver_id', req.user.id).maybeSingle();
    if (!trip) return res.status(403).json({ error: 'Access Denied: Trip does not belong to you.' });

    const { data: stops, error } = await supabase.from('trip_stops').select('*').eq('trip_display_id', tripDisplayId).order('sort_order', { ascending: true });

    if (error) return res.status(500).json({ error: 'Failed to fetch trip stops.', details: error.message });
    res.json(stops || []);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 8. FETCH ROUTE MAP POINTS (DRIVER)
// ============================================================================
router.get('/trips/:tripDisplayId/route-points', authenticate, requireRole(['driver']), async (req, res) => {
  const { tripDisplayId } = req.params;

  try {
    const { data: trip } = await supabase.from('trips').select('id').eq('trip_display_id', tripDisplayId).eq('driver_id', req.user.id).maybeSingle();
    if (!trip) return res.status(403).json({ error: 'Access Denied: Trip does not belong to you.' });

    const { data: points, error } = await supabase.from('route_map_points').select('*').eq('trip_display_id', tripDisplayId).order('sort_order', { ascending: true });

    if (error) return res.status(500).json({ error: 'Failed to fetch route points.', details: error.message });
    res.json(points || []);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 9. FETCH DRIVER BIDS (DRIVER)
// ============================================================================
router.get('/bids', authenticate, requireRole(['driver']), async (req, res) => {
  try {
    const { data: bids, error } = await supabase
      .from('load_bids')
      .select('*')
      .eq('driver_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: 'Failed to fetch bids.', details: error.message });
    res.json(bids || []);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 10. WITHDRAW FUNDS FROM WALLET (DRIVER)
// ============================================================================
router.post('/wallet/withdraw', authenticate, requireRole(['driver']), validateBody(withdrawSchema), async (req, res) => {
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
    const { error: rpcErr } = await supabase.rpc('withdraw_funds_tx', {
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
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 11. GET DRIVER REPUTATION (DRIVER)
// ============================================================================
router.get('/:driverId/reputation', authenticate, requireRole(['driver']), async (req, res) => {
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

