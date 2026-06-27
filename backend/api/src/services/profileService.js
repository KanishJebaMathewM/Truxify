import { supabase } from '../config/db.js';

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