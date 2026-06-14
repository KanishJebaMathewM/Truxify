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

    // Invalidate the profile cache so that the next request retrieves fresh profile data
    if (req.user && req.user.uid) {
      await invalidateCachedProfile(req.user.uid);
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