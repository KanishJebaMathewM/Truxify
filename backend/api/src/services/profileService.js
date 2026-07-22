import { supabase } from '../config/db.js';
import { measureExecution } from '../core/performanceMetrics.js';

export async function getProfile(userId) {
  return measureExecution('ProfileService.getProfile', async () => {
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
  });
}

export async function getCustomerStats(userId) {
  return measureExecution('ProfileService.getCustomerStats', async () => {
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
  });
}

export async function getDriverDetails(userId) {
  return measureExecution('ProfileService.getDriverDetails', async () => {
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
