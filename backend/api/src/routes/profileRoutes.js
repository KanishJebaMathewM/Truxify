import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { validateBody } from '../middleware/validate.js';
import {
  getProfile,
  getCustomerStats,
  getDriverDetails
} from '../services/profileService.js';
import { supabase } from '../config/db.js';
import { ProfileModel } from '../models/ProfileModel.js';
import { invalidateCachedProfile, invalidateCachedSupabaseProfile } from '../lib/profileCache.js';
import { validateParams } from '../middleware/validate.js';
import { paramIdSchema } from '../validation/requestSchemas.js';
import { updateProfileSchema, updateWalletSchema } from '../validation/requestSchemas.js';

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
router.get('/:id/name', authenticate, userLimiter, validateParams(paramIdSchema), async (req, res) => {
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

    const { error: driverDetailsErr } = await supabase
      .from('driver_details')
      .upsert({ user_id: userId, polygon_wallet_address: normalized }, { onConflict: 'user_id' });

    if (driverDetailsErr) {
      return res.status(500).json({ error: 'Failed to sync wallet to driver details.', details: driverDetailsErr.message });
    }

    if (req.user && req.user.uid) {
      try { await invalidateCachedProfile(req.user.uid); } catch (_) { logger.error('Cache invalidation failed', _); }
    }
    if (req.user && req.user.id) {
      void invalidateCachedSupabaseProfile(req.user.id);
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
      void invalidateCachedSupabaseProfile(req.user.id);
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
router.put('/fcm-token', authenticate, userLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const { fcmToken } = req.body;

    if (fcmToken === undefined) {
      return res.status(400).json({ error: 'fcmToken is required. To clear, explicitly set to null.' });
    }

    if (fcmToken !== null && typeof fcmToken !== 'string') {
      return res.status(400).json({ error: 'fcmToken must be a string or null.' });
    }

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
      void invalidateCachedSupabaseProfile(req.user.id);
    }

    return res.json({ success: true, message: 'FCM token updated successfully.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update FCM token.', details: err.message });
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

    await Promise.all([
      invalidateCachedProfile(targetUserId),
      invalidateCachedSupabaseProfile(targetUserId),
    ]);

    return res.json({ success: true, message: `Cache invalidated for user ${targetUserId}.` });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to invalidate profile cache.', details: err.message });
  }
});

export default router;