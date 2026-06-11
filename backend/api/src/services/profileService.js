import { supabase } from '../config/db.js';

export async function getProfile(userId) {
  if (!supabase) {
    return {
      id: userId,
      firebase_uid: 'test',
      role: 'customer',
      full_name: 'Test User',
      phone: '+919999999999'
    };
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
  if (!supabase) return { total_orders: 0, total_saved: 0, co2_reduced_kg: 0 };

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
    return {
      truck_id: null,
      rating: 0,
      total_trips: 0,
      completion_rate: 0,
      is_online: false,
      wallet_confirmed: 0,
      wallet_pending: 0,
      wallet_total: 0
    };
  }

  const { data, error } = await supabase
    .from('driver_details')
    .select('*')
    .eq('user_id', userId)   // ✅ FIXED LINE
    .maybeSingle();

  if (error) throw error;
  return data;
}