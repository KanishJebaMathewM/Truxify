import { supabase, redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';

export async function getProfile(userId) {
  if (!supabase) {
    throw new Error('Supabase client not configured — check SUPABASE_URL and SUPABASE_ANON_KEY');
  }

  const { data, error } = await supabase
    .from('profiles')
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
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function createProfile(profileData) {
  if (!supabase) throw new Error('Supabase client not configured');
  const { data, error } = await supabase.from('profiles').insert(profileData).select().single();
  if (error) throw error;
  return data;
}

export async function updateProfile(userId, updateData) {
  if (!supabase) throw new Error('Supabase client not configured');
  const { data, error } = await supabase.from('profiles').update(updateData).eq('id', userId).select().single();
  if (error) throw error;
  return data;
}

export async function invalidateProfileCache(userId) {
  if (redisClient) {
    try {
      await redisClient.del(`profile:${userId}`);
    } catch (err) {
      logger.error({ err }, 'Redis cache invalidation error');
    }
  }
}
