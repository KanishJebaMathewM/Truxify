import { supabase } from '../config/db.js';
import { setCachedProfile } from '../lib/profileCache.js';
import logger from '../middleware/logger.js';

// Profile cache warming utility for frequently accessed profiles
async function warmProfileCache(userId) {
  try {
    const profile = await getProfile(userId);
    if (profile) {
      await setCachedProfile(userId, profile);
      logger.info('[ProfileCache] Cache warmed for user: ' + userId);
    }
  } catch (err) {
    logger.error('[ProfileCache] Cache warm failed for user ' + userId + ': ' + err.message);
  }
}

export async function getProfile(userId) {
  if (!supabase) {
    throw new Error('Supabase client not configured — check SUPABASE_URL and SUPABASE_ANON_KEY');
  }

  const { data, error } = await supabase
    .from('profiles')   // ✅ FIXED HERE
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getCustomerStats(userId) {
  if (!supabase) {
    throw new Error('Supabase client not configured — check SUPABASE_URL and SUPABASE_ANON_KEY');
  }

  const { data, error } = await supabase
    .from('customer_stats')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getDriverDetails(userId) {
  if (!supabase) {
    throw new Error('Supabase client not configured — check SUPABASE_URL and SUPABASE_ANON_KEY');
  }

  const { data, error } = await supabase
    .from('driver_details')
    .select('*')
    .eq('user_id', userId)   // ✅ FIXED LINE
    .maybeSingle();

  if (error) throw error;
  return data;
}