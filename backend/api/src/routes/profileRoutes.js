import express from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getProfile,
  getCustomerStats,
  getDriverDetails
} from '../services/profileService.js';
import { supabase } from '../config/db.js';
import { ProfileModel } from '../models/ProfileModel.js';
import { invalidateCachedProfile } from '../lib/profileCache.js';

const router = express.Router();

// GET PROFILE
router.get('/', authenticate, async (req, res) => {
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
router.get('/:id/name', authenticate, async (req, res) => {
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

// UPDATE PROFILE (basic version)
router.put('/', authenticate, async (req, res) => {
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
    // We intentionally do not await here (making it fire-and-forget) to avoid adding
    // Redis network round-trip latency to the response path. Since invalidateCachedProfile
    // catches and logs errors internally, and the client receives the updated profile in the
    // response payload, fire-and-forget is the optimal choice.
    if (req.user && req.user.uid) {
      void invalidateCachedProfile(req.user.uid);
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

export default router;