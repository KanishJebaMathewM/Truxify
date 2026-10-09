/**
 * Order Model
 * Handles database queries for orders and order timelines.
 */
import { supabase } from '../config/db.js';

export const orderModel = {
  async getTimelineEntries(orderId) {
    const { data, error } = await supabase
      .from('order_timelines')
      .select('id, order_id, status, milestone_time, updated_at, created_at, metadata')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch order timeline: ${error.message}`);
    }

    // Map rows to ensure milestone_time is consistently available
    return (data || []).map((row) => ({
      ...row,
      milestone_time: row.milestone_time || row.updated_at || row.created_at,
    }));
  },
};

export default orderModel;
