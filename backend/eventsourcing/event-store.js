import { supabase } from '../config/db.js';
import logger from '../middleware/logger.js';
import { deriveOrderStatus } from '../../eventsourcing/read-model-schema.js';
import { assertOrderReadModelRow } from '../../eventsourcing/read-model-schema.js';

// Active channels and pending reconnection timers mapped by orderUUID
const locationChannels = new Map();
const reconnectTimers = new Map();

/**
 * Cancels any active reconnection timer for a specific order.
 */
function cancelPendingReconnect(orderUUID) {
  if (reconnectTimers.has(orderUUID)) {
    clearTimeout(reconnectTimers.get(orderUUID));
    reconnectTimers.delete(orderUUID);
  }
}

/**
 * Connects to a Supabase Realtime channel for driver location updates.
 * - Removes old errored channel instances before retry.
 * - Tracks pending retry timers to prevent race conditions after disconnects.
 */
export async function connectChannel(orderUUID, reconnectAttempts = 0) {
  cancelPendingReconnect(orderUUID);

  // Issue 1 Fix: Explicitly remove and delete existing channel before retrying
  if (locationChannels.has(orderUUID)) {
    const existingChannel = locationChannels.get(orderUUID);
    await supabase.removeChannel(existingChannel);
    locationChannels.delete(orderUUID);
  }

  const channel = supabase.channel(`order-location:${orderUUID}`);
  locationChannels.set(orderUUID, channel);

  channel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'locations' }, (payload) => {
      logger.info({ orderUUID, payload }, 'Received location update');
    })
    .subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR' || err) {
        const backoffMs = reconnectAttempts * 1000;
        logger.warn({ orderUUID, reconnectAttempts, backoffMs }, 'Supabase Realtime channel error. Retrying connection.');

        // Remove the failed SDK channel immediately
        if (locationChannels.get(orderUUID) === channel) {
          supabase.removeChannel(channel);
          locationChannels.delete(orderUUID);
        }

        // Issue 2 Fix: Track retry timer handle to allow cancellation on channel removal
        const timerId = setTimeout(() => {
          reconnectTimers.delete(orderUUID);
          connectChannel(orderUUID, reconnectAttempts + 1);
        }, backoffMs);

        reconnectTimers.set(orderUUID, timerId);
      }
    });
}

/**
 * Removes channel for a given order and cancels any pending retries.
 */
export function removeDriverLocationChannels(orderUUID) {
  // Issue 2 Fix: Cancel pending retries when channel ownership ends
  cancelPendingReconnect(orderUUID);

  if (locationChannels.has(orderUUID)) {
    const channel = locationChannels.get(orderUUID);
    supabase.removeChannel(channel);
    locationChannels.delete(orderUUID);
  }
}

/**
 * Cleans up all channels and pending reconnection timers on server shutdown.
 */
export function cleanupAllChannels() {
  // Clear all pending reconnect timers
  for (const [orderUUID, timerId] of reconnectTimers.entries()) {
    clearTimeout(timerId);
  }
  reconnectTimers.clear();

  // Remove all active channel subscriptions
  for (const [orderUUID, channel] of locationChannels.entries()) {
    supabase.removeChannel(channel);
  }
  locationChannels.clear();
}

/**
 * Helper method for updating the order read model.
 * Issue 3 Fix: Uses state?.timeline ?? null instead of synthesizing a fake timeline entry.
 */
export async function upsertOrderReadModel(orderId, state, eventType, version) {
  const status = deriveOrderStatus(state) || state?.status || eventType;
  
  // Issue 3 Fix: Do not synthesize a fake timeline array. Use state.timeline or null.
  const timeline = state?.timeline ?? null;

  const row = {
    order_id: orderId,
    payload: state,
    event_type: eventType,
    version: version ?? state?.version,
    status,
    timeline,
    updated_at: new Date().toISOString(),
  };

  try {
    assertOrderReadModelRow(row);
  } catch (assertionErr) {
    logger.error('Order read model row assertion failed:', assertionErr);
    throw assertionErr;
  }

  const { error } = await supabase
    .from('orders_read_model')
    .upsert([row], {
      onConflict: 'order_id',
    });

  if (error) {
    logger.error('Failed to update order read model:', error);
    throw error;
  }
}
