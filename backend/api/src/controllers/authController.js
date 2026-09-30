import logger from '../api/src/middleware/logger.js';

class RealtimeLocationManager {
  constructor(supabaseClient) {
    this.supabase = supabaseClient;
    this.locationChannels = new Map();               // Key: channelKey, Value: Channel
    this.driverToLocationChannels = new Map();       // Key: driverId, Value: Set<channelKey>
    this.displayIdToLocationChannelKeys = new Map(); // Key: displayId, Value: Set<channelKey>
    this.retryTimers = new Map();                     // Key: channelKey, Value: Timeout Handle

    this.MAX_RECONNECT_ATTEMPTS = 5;
    this.BASE_RECONNECT_DELAY_MS = 1000;
  }

  /**
   * Connects or reconnects a driver location channel
   */
  connectChannel(channelKey, driverId, displayId, attempt = 0) {
    // Clear any pending retry timers for this channel key
    this.clearRetryTimer(channelKey);

    // Clean up existing channel instance before recreating
    if (this.locationChannels.has(channelKey)) {
      this.removeChannel(channelKey, driverId, displayId);
    }

    const channelName = `driver-location:${channelKey}`;
    const channel = this.supabase.channel(channelName);

    channel
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations' }, (payload) => {
        this.handleLocationUpdate(driverId, displayId, payload);
      })
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          logger.info(`[Realtime] Subscribed to location channel: ${channelKey}`);
          this.clearRetryTimer(channelKey);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          logger.warn(`[Realtime] Channel error for ${channelKey}: ${err?.message || status}`);
          this.handleChannelFailure(channelKey, driverId, displayId, attempt + 1);
        }
      });

    this.locationChannels.set(channelKey, channel);

    // Establish driver membership mappings
    if (!this.driverToLocationChannels.has(driverId)) {
      this.driverToLocationChannels.set(driverId, new Set());
    }
    this.driverToLocationChannels.get(driverId).add(channelKey);

    if (displayId) {
      if (!this.displayIdToLocationChannelKeys.has(displayId)) {
        this.displayIdToLocationChannelKeys.set(displayId, new Set());
      }
      this.displayIdToLocationChannelKeys.get(displayId).add(channelKey);
    }
  }

  /**
   * Handles channel failure with explicit cleanup and exponential backoff
   */
  handleChannelFailure(channelKey, driverId, displayId, attempt) {
    // Explicitly call centralized channel cleanup on failure
    this.removeChannel(channelKey, driverId, displayId);

    if (attempt > this.MAX_RECONNECT_ATTEMPTS) {
      logger.error(`[Realtime] Max reconnect attempts (${this.MAX_RECONNECT_ATTEMPTS}) reached for ${channelKey}. Halting retries.`);
      return;
    }

    const delayMs = Math.pow(2, attempt - 1) * this.BASE_RECONNECT_DELAY_MS;
    logger.info(`[Realtime] Scheduling retry ${attempt}/${this.MAX_RECONNECT_ATTEMPTS} for ${channelKey} in ${delayMs}ms`);

    const timer = setTimeout(() => {
      this.retryTimers.delete(channelKey);

      // Guard: Only reconnect if driver membership is still intact
      const driverKeys = this.driverToLocationChannels.get(driverId);
      if (driverKeys && driverKeys.has(channelKey)) {
        this.connectChannel(channelKey, driverId, displayId, attempt);
      } else {
        logger.info(`[Realtime] Suppressed retry for ${channelKey}; channel membership was invalidated`);
      }
    }, delayMs);

    this.retryTimers.set(channelKey, timer);
  }

  /**
   * Centralized method to remove channel from Supabase and invalidate all associated mappings
   */
  removeChannel(channelKey, driverId, displayId) {
    const channel = this.locationChannels.get(channelKey);
    if (channel) {
      try {
        this.supabase.removeChannel(channel);
      } catch (err) {
        logger.error(`[Realtime] Error removing channel ${channelKey} from Supabase: ${err.message}`);
      }
      this.locationChannels.delete(channelKey);
    }

    // Invalidate driver membership
    if (driverId && this.driverToLocationChannels.has(driverId)) {
      const keys = this.driverToLocationChannels.get(driverId);
      keys.delete(channelKey);
      if (keys.size === 0) {
        this.driverToLocationChannels.delete(driverId);
      }
    }

    // Invalidate displayId membership
    if (displayId && this.displayIdToLocationChannelKeys.has(displayId)) {
      const keys = this.displayIdToLocationChannelKeys.get(displayId);
      keys.delete(channelKey);
      if (keys.size === 0) {
        this.displayIdToLocationChannelKeys.delete(displayId);
      }
    }
  }

  /**
   * Clears pending retry timers for a specific channel key
   */
  clearRetryTimer(channelKey) {
    if (this.retryTimers.has(channelKey)) {
      clearTimeout(this.retryTimers.get(channelKey));
      this.retryTimers.delete(channelKey);
    }
  }

  /**
   * Removes all location channels and cancels retries for a specific driver
   */
  removeDriverLocationChannels(driverId) {
    const channelKeys = this.driverToLocationChannels.get(driverId);
    if (!channelKeys) return;

    for (const channelKey of Array.from(channelKeys)) {
      this.clearRetryTimer(channelKey);
      this.removeChannel(channelKey, driverId);
    }

    this.driverToLocationChannels.delete(driverId);
    logger.info(`[Realtime] Successfully cleaned up channels and cancelled retries for driver: ${driverId}`);
  }

  /**
   * Complete cleanup of all active subscriptions, maps, and timers
   */
  removeClientFromAllSubscriptions() {
    // 1. Cancel all pending retry timers
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();

    // 2. Remove all active channels from Supabase
    for (const [channelKey, channel] of this.locationChannels.entries()) {
      try {
        this.supabase.removeChannel(channel);
      } catch (err) {
        logger.error(`[Realtime] Error removing channel ${channelKey} during complete cleanup: ${err.message}`);
      }
    }

    // 3. Clear all tracking maps
    this.locationChannels.clear();
    this.driverToLocationChannels.clear();
    this.displayIdToLocationChannelKeys.clear();

    logger.info('[Realtime] Removed all client subscriptions, invalidated mappings, and cleared retry timers.');
  }

  handleLocationUpdate(driverId, displayId, payload) {
    // Payload processing logic
  }
}

export default RealtimeLocationManager;
