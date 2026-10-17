/**
 * Order Timeline Service
 * Manages order tracking milestones and timeline data retrieval.
 */
import orderModel from '../models/orderModel.js';

export async function getOrderTimeline(orderId) {
  const timelineEntries = await orderModel.getTimelineEntries(orderId);

  // Transform or ensure milestone_time is present and fallback/map correctly
  return timelineEntries.map((entry) => ({
    ...entry,
    milestone_time: entry.milestone_time || entry.updated_at || entry.created_at,
    updated_at: entry.updated_at || entry.milestone_time, // keep updated_at populated just in case
  }));
}

export default {
  getOrderTimeline,
};
