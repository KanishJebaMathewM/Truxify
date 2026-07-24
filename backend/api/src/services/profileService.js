import { supabase } from '../config/db.js';
import { measureExecution } from '../core/performanceMetrics.js';
import {
  getCachedSupabaseProfile, setCachedSupabaseProfile,
  getCachedCustomerStats, setCachedCustomerStats,
  getCachedDriverDetails, setCachedDriverDetails,
} from '../lib/profileCache.js';
import logger from '../middleware/logger.js';

function isCacheEnabled() {
  return process.env.CACHE_ENABLED !== 'false';
}

export async function getProfile(userId) {
  return measureExecution('ProfileService.getProfile', async () => {
  if (!supabase) {
    throw new Error('Supabase client not configured — check SUPABASE_URL and SUPABASE_ANON_KEY');
  }

  if (isCacheEnabled()) {
    try {
      const cached = await getCachedSupabaseProfile(userId);
      if (cached) {
        logger.debug({ userId }, 'Profile cache hit');
        return cached;
      }
    } catch (err) {
      logger.warn({ err, userId }, 'Profile cache read failed, falling back to database');
    }
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;

  if (isCacheEnabled() && data) {
    try {
      await setCachedSupabaseProfile(userId, data);
    } catch (err) {
      logger.warn({ err, userId }, 'Profile cache write failed');
    }
  }

  return data;
  });
}

export async function getCustomerStats(userId) {
  return measureExecution('ProfileService.getCustomerStats', async () => {
  if (!supabase) {
    throw new Error('Supabase client not configured — check SUPABASE_URL and SUPABASE_ANON_KEY');
  }

  if (isCacheEnabled()) {
    try {
      const cached = await getCachedCustomerStats(userId);
      if (cached) {
        logger.debug({ userId }, 'Customer stats cache hit');
        return cached;
      }
    } catch (err) {
      logger.warn({ err, userId }, 'Customer stats cache read failed, falling back to database');
    }
  }

  const { data, error } = await supabase
    .from('customer_stats')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;

  if (isCacheEnabled() && data) {
    try {
      await setCachedCustomerStats(userId, data);
    } catch (err) {
      logger.warn({ err, userId }, 'Customer stats cache write failed');
    }
  }

  return data;
  });
}

export async function getDriverDetails(userId) {
  return measureExecution('ProfileService.getDriverDetails', async () => {
  if (!supabase) {
    throw new Error('Supabase client not configured — check SUPABASE_URL and SUPABASE_ANON_KEY');
  }

  if (isCacheEnabled()) {
    try {
      const cached = await getCachedDriverDetails(userId);
      if (cached) {
        logger.debug({ userId }, 'Driver details cache hit');
        return cached;
      }
    } catch (err) {
      logger.warn({ err, userId }, 'Driver details cache read failed, falling back to database');
    }
  }

  const { data, error } = await supabase
    .from('driver_details')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;

  if (isCacheEnabled() && data) {
    try {
      await setCachedDriverDetails(userId, data);
    } catch (err) {
      logger.warn({ err, userId }, 'Driver details cache write failed');
    }
  }

  return data;
  });
}

export async function createProfile(profileData) {
  return measureExecution('ProfileService.createProfile', async () => {
  if (!supabase) throw new Error('Supabase client not configured');
  const { data, error } = await supabase.from('profiles').insert(profileData).select().single();
  if (error) throw error;
  return data;
  });
}

export async function updateProfile(userId, updateData) {
  return measureExecution('ProfileService.updateProfile', async () => {
  if (!supabase) throw new Error('Supabase client not configured');
  const { data, error } = await supabase.from('profiles').update(updateData).eq('id', userId).select().single();
  if (error) throw error;
  return data;
  });
}
