import { supabase, supabaseAdmin } from '../config/db.js';
import { measureExecution } from '../core/performanceMetrics.js';
import {
  getCachedSupabaseProfile, setCachedSupabaseProfile, isValidCachedProfile,
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

  if (isCacheEnabled()) {
    try {
      const cached = await getCachedSupabaseProfile(userId);
      if (cached && isValidCachedProfile(userId, cached)) {
        logger.debug({ userId }, 'Profile cache hit');
        return cached;
      }
    } catch (err) {
      logger.warn({ err, userId }, 'Profile cache read failed, falling back to database');
    }
  }

  const { data, error } = await supabaseAdmin
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
  const { data: orders, error } = await client
    .from('orders')
    .select('status, total_amount')
    .eq('customer_id', userId);

  if (error) throw error;

  const stats = {
    user_id: userId,
    total_orders: (orders || []).length,
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
      logger.warn({ err, userId }, 'Driver details cache read failed, falling back to database');
    }
  }

  const { data, error } = await supabaseAdmin
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
  if (!supabaseAdmin) throw new Error('Supabase client not configured');
  const { data, error } = await supabaseAdmin.from('profiles').insert(profileData).select().single();
  if (error) { logger.error("[ProfileService] createProfile error:", error?.message || error); throw error; }
  return data;
  });
}

export async function updateProfile(userId, updateData) {
  return measureExecution('ProfileService.updateProfile', async () => {
  if (!supabaseAdmin) throw new Error('Supabase client not configured');
  const { data, error } = await supabaseAdmin.from('profiles').update(updateData).eq('id', userId).select().single();
  if (error) { logger.error("[ProfileService] updateProfile error:", error?.message || error); throw error; }
  return data;
  });
}

export async function deleteProfile(userId) {
  return measureExecution('ProfileService.deleteProfile', async () => {
  if (!supabaseAdmin) throw new Error('Supabase client not configured');
  const { data, error } = await supabaseAdmin.from('profiles').delete().eq('id', userId).select().maybeSingle();
  if (error) { logger.error("[ProfileService] deleteProfile error:", error?.message || error); throw error; }
  return data;
  });
}

export async function getProfileById(userId) {
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    return null;
  }
  return getProfile(userId);
}

export function sanitizeProfilePii(profile) {
  if (!profile) return null;
  const sanitized = { ...profile };
  if (sanitized.phone && typeof sanitized.phone === 'string') {
    sanitized.phone = sanitized.phone.length > 4
      ? sanitized.phone.slice(0, -4).replace(/./g, '*') + sanitized.phone.slice(-4)
      : '****';
  }
  if (sanitized.email && typeof sanitized.email === 'string') {
    const [name, domain] = sanitized.email.split('@');
    if (domain) {
      const maskedName = name.length > 2
        ? name[0] + '*'.repeat(name.length - 2) + name[name.length - 1]
        : '*'.repeat(name.length);
      sanitized.email = `${maskedName}@${domain}`;
    }
  }
  if (sanitized.kyc_doc_number) {
    sanitized.kyc_doc_number = '********';
  }
  return sanitized;
}

export const ProfileService = {
  getProfile,
  getProfileById,
  getCustomerStats,
  getDriverDetails,
  createProfile,
  updateProfile,
  deleteProfile,
  sanitizeProfilePii,
};

export default ProfileService;

