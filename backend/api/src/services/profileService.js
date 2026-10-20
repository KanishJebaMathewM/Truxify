import { supabase, supabaseAdmin } from '../config/db.js';
import { measureExecution } from '../core/performanceMetrics.js';
import {
  getCachedCustomerStats, setCachedCustomerStats,
  getCachedDriverDetails, setCachedDriverDetails,
} from '../lib/profileCache.js';
import logger from '../middleware/logger.js';

function isCacheEnabled() {
  return process.env.CACHE_ENABLED !== 'false';
}

export async function getProfile(userId) {
  return measureExecution('ProfileService.getProfile', async () => {
    if (!supabaseAdmin) {
      throw new Error('Supabase client not configured — check SUPABASE_URL and SUPABASE_ANON_KEY');
    }

    // Authentication owns this cache key and stores a normalized user record.
    // Full profile reads need the complete database shape and must not consume
    // or overwrite authentication records or tombstones.
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;

    return data;
  });
}

export async function getCustomerStats(userId) {
  return measureExecution('ProfileService.getCustomerStats', async () => {
    const client = supabaseAdmin || supabase;
    if (!client) {
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

    // customer_stats was never populated by any write path, so stats are
    // computed from the customer's orders at request time. Reads go through
    // the service-role client when available (RLS would hide other orders).
    // Count at the database boundary: Data API row caps must not truncate totals.
    const { count, error } = await client
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', userId);

    if (error) throw error;

    const stats = {
      user_id: userId,
      total_orders: count ?? 0,
      // No broker-baseline data exists on orders to compute savings / CO2.
      total_saved: 0,
      co2_reduced_kg: 0,
    };

    if (isCacheEnabled()) {
      try {
        await setCachedCustomerStats(userId, stats);
      } catch (err) {
        logger.warn({ err, userId }, 'Customer stats cache write failed');
      }
    }

    return stats;
  });
}

export async function getDriverDetails(userId) {
  return measureExecution('ProfileService.getDriverDetails', async () => {
    if (!supabaseAdmin) {
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
        logger
