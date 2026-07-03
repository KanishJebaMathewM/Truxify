import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { updateProfileSchema, updateWalletSchema, driverStatementSchema, paramIdSchema, uuidParamSchema, updateFcmTokenSchema } from '../validation/requestSchemas.js';
import logger from '../middleware/logger.js';
import {
  getProfile,
  getCustomerStats,
  getDriverDetails
} from '../services/profileService.js';
import { supabase } from '../config/db.js';
import { ProfileModel } from '../models/ProfileModel.js';
import { invalidateCachedProfile, invalidateCachedSupabaseProfile } from '../lib/profileCache.js';
const router = express.Router();

// GET PROFILE
router.get('/', authenticate, userLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;

    // 1. base profile
    const profile = await getProfile(userId);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    let extra = null;

    // 2. role-based fetch
    if (role === 'customer') {
      const stats = await getCustomerStats(userId);
      extra = ProfileModel.fromCustomerStats(stats);
    }

    if (role === 'driver') {
      const details = await getDriverDetails(userId);
      extra = ProfileModel.fromDriverDetails(details);
    }

    return res.json({
      profile: ProfileModel.fromProfile(profile),
      extra
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to fetch profile',
      details: err.message
    });
  }
});

// GET PROFILE NAME BY ID
router.get('/:id/name', authenticate, userLimiter, validateParams(uuidParamSchema), async (req, res) => {
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) return res.status(500).json({ error: 'Failed to fetch profile name.', details: error.message });
    if (!profile) return res.status(404).json({ error: 'Profile not found.' });

    res.json({ full_name: profile.full_name });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// UPDATE WALLET ADDRESS
router.put('/wallet', authenticate, userLimiter, validateBody(updateWalletSchema), async (req, res) => {
  const userId = req.user.id;
  const { wallet_address } = req.body;

  if (!wallet_address || typeof wallet_address !== 'string') {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  const normalized = wallet_address.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  try {
    const { data: existing, error: checkErr } = await supabase
      .from('profiles')
      .select('wallet_address, polygon_wallet_address')
      .eq('id', userId)
      .maybeSingle();

    if (checkErr) return res.status(500).json({ error: 'Failed to fetch profile.', details: checkErr.message });
    if (!existing) return res.status(404).json({ error: 'Profile not found.' });

    const { error: updateErr } = await supabase
      .from('profiles')
      .update({
        wallet_address: normalized,
        polygon_wallet_address: normalized,
      })
      .eq('id', userId);

    if (updateErr) {
      if (updateErr.code === '23505') {
        return res.status(409).json({ error: 'This wallet address is already registered to another account.' });
      }
      return res.status(500).json({ error: 'Failed to update wallet address.', details: updateErr.message });
    }

    if (req.user.role === 'driver') {
      const { error: driverDetailsErr } = await supabase
        .from('driver_details')
        .upsert({ user_id: userId, polygon_wallet_address: normalized }, { onConflict: 'user_id' });

      if (driverDetailsErr) {
        return res.status(500).json({ error: 'Failed to sync wallet to driver details.', details: driverDetailsErr.message });
      }
    }

    if (req.user && req.user.uid) {
      try { await invalidateCachedProfile(req.user.uid); } catch (_) { logger.error('Cache invalidation failed', _); }
    }
    if (req.user && req.user.id) {
      try {
        await invalidateCachedSupabaseProfile(req.user.id);
      } catch (err) {
        logger.warn('[profileRoutes] Failed to invalidate profile cache for user %s: %s', req.user.id, err.message);
      }
    }

    res.json({ success: true, walletAddress: normalized });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error.' });
  }
});

// UPDATE PROFILE (basic version)
router.put('/', authenticate, userLimiter, validateBody(updateProfileSchema), async (req, res) => {
  try {
    const userId = req.user.id;
    const { full_name, language, dark_mode, is_online } = req.body;
    const role = req.user.role;

    const { data, error } = await supabase
      .from('profiles')
      .update({
        full_name,
        language,
        dark_mode
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;
    if (role === 'driver' && typeof is_online === 'boolean') {
      const { error: driverError } = await supabase
      .from('driver_details')
      .update({
        is_online
      })
      .eq('user_id', userId);

      if (driverError) throw driverError;
    }

    // Invalidate the profile cache so that the next request retrieves fresh profile data.
    // We await to ensure cache consistency — failures are caught and logged internally.
    if (req.user && req.user.uid) {
      try { await invalidateCachedProfile(req.user.uid); } catch (_) { /* logged internally */ }
    }
    if (req.user && req.user.id) {
      try {
        await invalidateCachedSupabaseProfile(req.user.id);
      } catch (err) {
        logger.warn('[profileRoutes] Failed to invalidate profile cache for user %s: %s', req.user.id, err.message);
      }
    }

    res.json({
      message: 'Profile updated',
      profile: data
    });

  } catch (err) {
    res.status(500).json({
      error: 'Failed to update profile',
      details: err.message
    });
  }
});

// UPDATE FCM TOKEN
// Stores or clears the device FCM token for push notification delivery.
// Invalidates Redis cache so the next authenticated request picks up the new token.
router.put('/fcm-token', authenticate, userLimiter, validateBody(updateFcmTokenSchema), async (req, res) => {
  try {
    const userId = req.user.id;
    const { fcmToken } = req.body;

    const { error } = await supabase
      .from('profiles')
      .update({
        fcm_token: fcmToken,
        fcm_token_updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (error) {
      return res.status(500).json({ error: 'Failed to update FCM token.', details: error.message });
    }

    // Invalidate Redis cache — next request will refetch the profile with the new token
    if (req.user.uid) {
      try { await invalidateCachedProfile(req.user.uid); } catch (_) { /* logged internally */ }
    }
    if (req.user.id) {
      try {
        await invalidateCachedSupabaseProfile(req.user.id);
      } catch (err) {
        logger.warn('[profileRoutes] Failed to invalidate profile cache for user %s: %s', req.user.id, err.message);
      }
    }

    return res.json({ success: true, message: 'FCM token updated successfully.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update FCM token.', details: err.message });
  }
});

// GET DRIVER STATEMENT
router.get('/driver/statement', authenticate, requireRole(['driver']), userLimiter, validateQuery(driverStatementSchema), async (req, res) => {
  const userId = req.user.id;
  const { start_date, end_date, sort_by, format } = req.query;

  try {
    let query = supabase
      .from('orders')
      .select('id, order_display_id, status, pickup_address, drop_address, pickup_date, total_amount, base_freight, toll_estimate, platform_fee, created_at')
      .eq('driver_id', userId)
      .in('status', ['delivered', 'payment_released']);

    if (start_date) {
      query = query.gte('pickup_date', start_date);
    }
    if (end_date) {
      query = query.lte('pickup_date', end_date);
    }

    const { data: trips, error } = await query.order('pickup_date', { ascending: false });

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch statement records.', details: error.message });
    }

    // Compute totals
    let totalBaseFreight = 0;
    let totalPlatformFees = 0;
    let totalTollEstimate = 0;
    let totalNetEarnings = 0;

    const tripsList = (trips || []).map(trip => {
      const baseFreight = Number(trip.base_freight) || 0;
      const platformFee = Number(trip.platform_fee) || 0;
      const tollEstimate = Number(trip.toll_estimate) || 0;
      const netEarnings = baseFreight - platformFee;

      totalBaseFreight += baseFreight;
      totalPlatformFees += platformFee;
      totalTollEstimate += tollEstimate;
      totalNetEarnings += netEarnings;

      return {
        id: trip.id,
        order_display_id: trip.order_display_id,
        pickup_address: trip.pickup_address,
        drop_address: trip.drop_address,
        pickup_date: trip.pickup_date,
        base_freight: baseFreight,
        platform_fee: platformFee,
        toll_estimate: tollEstimate,
        net_earnings: netEarnings,
        status: trip.status
      };
    });

    if (format === 'csv') {
      // Optimize memory: construct CSV string directly using string builder/loop
      const headers = ['ID', 'Order Display ID', 'Pickup Address', 'Drop Address', 'Pickup Date', 'Base Freight', 'Platform Fee', 'Toll Estimate', 'Net Earnings', 'Status'];
      let csvString = headers.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',') + '\n';
      for (const t of tripsList) {
        const row = [t.id, t.order_display_id, t.pickup_address, t.drop_address, t.pickup_date, t.base_freight, t.platform_fee, t.toll_estimate, t.net_earnings, t.status];
        csvString += row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',') + '\n';
      }
      res.setHeader('Content-Type', 'text/csv');
      return res.send(csvString.trimEnd());
    }
    if (sort_by === 'net_earnings') {
      tripsList.sort((a, b) => b.net_earnings - a.net_earnings);
    } else if (sort_by === 'base_freight') {
      tripsList.sort((a, b) => b.base_freight - a.base_freight);
    }

    res.json({
      summary: {
        total_trips: tripsList.length,
        total_base_freight: totalBaseFreight,
        total_platform_fees: totalPlatformFees,
        total_toll_estimate: totalTollEstimate,
        total_net_earnings: totalNetEarnings
      },
      trips: tripsList
    });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// ADMIN CACHE INVALIDATION
// Invalidates the profile cache for a specific user, forcing the next
// authenticated request to refetch from Supabase. Use this after admin
// operations that change role, status, or other cached profile fields.
router.delete('/admin/cache/:userId', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const targetUserId = req.params.userId;
    if (!targetUserId) {
      return res.status(400).json({ error: 'userId path parameter is required.' });
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let profile = null;
    let profileError = null;

    if (uuidRegex.test(targetUserId)) {
      const result = await supabase
        .from('profiles')
        .select('id, firebase_uid')
        .eq('id', targetUserId)
        .maybeSingle();
      profile = result.data;
      profileError = result.error;
    }

    if (!profile && !profileError) {
      const firebaseLookup = await supabase
        .from('profiles')
        .select('id, firebase_uid')
        .eq('firebase_uid', targetUserId)
        .maybeSingle();

      profile = firebaseLookup.data;
      profileError = firebaseLookup.error;
    }

    if (profileError) {
      return res.status(500).json({ error: 'Failed to resolve profile cache identity.', details: profileError.message });
    }

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found.' });
    }

    await Promise.all([
      profile.firebase_uid ? invalidateCachedProfile(profile.firebase_uid) : Promise.resolve(),
      invalidateCachedSupabaseProfile(profile.id),
    ]);

    return res.json({ success: true, message: `Cache invalidated for user ${profile.id}.` });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to invalidate profile cache.', details: err.message });
  }
});

export default router;
