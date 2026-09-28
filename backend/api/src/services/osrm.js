import logger from '../middleware/logger.js';
import { supabase } from '../config/supabaseClient.js';

// Map to store active location tracking channels by orderUUID
const locationChannels = new Map();

// Map to track active retry backoff timers by orderUUID
const retryTimers = new Map();

/**
 * Clears and removes any pending retry timers for a given order.
 * @param {string} orderUUID 
 */
function clearRetryTimer(orderUUID) {
  if (retryTimers.has(orderUUID)) {
    clearTimeout(retryTimers.get(orderUUID));
    retryTimers.delete(orderUUID);
  }
}

/**
 * Subscribes to real-time location updates for a specific order.
 * @param {string} orderUUID 
 * @param {Function} onLocationUpdate Callback function when a new location event arrives.
 * @param {number} reconnectAttempts Tracks backoff retry attempts.
 */
export function subscribeToOrderLocation(orderUUID, onLocationUpdate, reconnectAttempts = 0) {
  if (!orderUUID) return;

  // Clear any previously scheduled retry timer for this order
  clearRetryTimer(orderUUID);

  // If a channel already exists for this order, clean it up before creating a new one
  if (locationChannels.has(orderUUID)) {
    const existingChannel = locationChannels.get(orderUUID);
    supabase.removeChannel(existingChannel);
    locationChannels.delete(orderUUID);
  }

  const topic = `order-location:${orderUUID}`;
  const channel = supabase.channel(topic);

  // Track the newly created channel instance
  locationChannels.set(orderUUID, channel);

  channel
    .on('broadcast', { event: 'location_update' }, (payload) => {
      if (onLocationUpdate && typeof onLocationUpdate === 'function') {
        onLocationUpdate(payload);
      }
    })
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        logger.info({ orderUUID, topic }, '[Tracker] Successfully subscribed to order location channel');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        logger.warn(
          { orderUUID, status, err: err?.message, reconnectAttempts },
          '[Tracker] Supabase Realtime channel error or closed'
        );

        // 1. Explicitly remove the failed channel instance from Supabase client
        supabase.removeChannel(channel);

        // 2. Delete the map entry only if it still references this exact failed channel
        if (locationChannels.get(orderUUID) === channel) {
          locationChannels.delete(orderUUID);
        }

        // 3. Schedule retry with backoff, ensuring pending timers are tracked and ownership validated
        clearRetryTimer(orderUUID);
        const backoffMs = Math.min((reconnectAttempts + 1) * 1000, 10000);

        const timerId = setTimeout(() => {
          retryTimers.delete(orderUUID);

          // Verify the order wasn't unsubscribed or reassigned during the delay
          if (!locationChannels.has(orderUUID)) {
            subscribeToOrderLocation(orderUUID, onLocationUpdate, reconnectAttempts + 1);
          }
        }, backoffMs);

        retryTimers.set(orderUUID, timerId);
      }
    });

  return channel;
}

/**
 * Unsubscribes from location updates for a specific order and cleans up resources.
 * @param {string} orderUUID 
 */
export function unsubscribeFromOrderLocation(orderUUID) {
  if (!orderUUID) return;

  // Cancel any pending retries first
  clearRetryTimer(orderUUID);

  if (locationChannels.has(orderUUID)) {
    const channel = locationChannels.get(orderUUID);
    supabase.removeChannel(channel);
    locationChannels.delete(orderUUID);
    logger.info({ orderUUID }, '[Tracker] Unsubscribed from order location channel');
  }
}

/**
 * Cleanup function to disconnect all active channels and clear all pending retries.
 * Called during socket disconnects or server shutdown.
 */
export function cleanupAllLocationTrackers() {
  // Clear all pending retry timers
  for (const [orderUUID, timerId] of retryTimers.entries()) {
    clearTimeout(timerId);
  }
  retryTimers.clear();

  // Remove and close all active Supabase realtime channels
  for (const [orderUUID, channel] of locationChannels.entries()) {
    supabase.removeChannel(channel);
  }
  locationChannels.clear();

  logger.info('[Tracker] All location tracking channels and retry timers cleaned up');
}
