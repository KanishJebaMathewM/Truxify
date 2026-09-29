import logger from '../api/src/middleware/logger.js';

class RealtimeLocationManager {
  constructor(supabaseClient) {
    this.supabase = supabaseClient;
    this.locationChannels = new Map();         // Key: channelKey, Value: Channel
    this.driverToLocationChannels = new Map(); // Key: driverId, Value: Set<channelKey>
    this.displayIdToLocationChannelKeys = new Map(); // Key: displayId, Value: Set<channelKey>
    this.retryTimers = new Map();               // Key: channelKey, Value: Timeout Handle
    
    this.MAX_RECONNECT_ATTEMPTS = 5;
    this.BASE_RECONNECT_DELAY_MS = 1000;
  }

  /**
   * Connects or reconnects a driver location channel
   */
  connectChannel(channelKey, driverId, displayId, attempt = 0) {
    // Clear any existing pending retry timer for this channel key
    this.clearRetryTimer(channelKey);

    // Remove old channel from Supabase client if it exists to avoid socket leaks
    if (this.locationChannels.has(channelKey)) {
      this.cleanupChannel(channelKey);
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

    // Track mappings
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
   * Handles failure with capped exponential backoff and cleanup
   */
  handleChannelFailure(channelKey, driverId, displayId, attempt) {
    // Explicitly remove failed channel from Supabase client
    this.cleanupChannel(channelKey);

    if (attempt > this.MAX_RECONNECT_ATTEMPTS) {
      logger.error(`[Realtime] Max reconnect attempts (${this.MAX_RECONNECT_ATTEMPTS}) reached for ${channelKey}. Halting retries.`);
      this.purgeChannelMappings(channelKey, driverId, displayId);
      return;
    }

    // True exponential backoff: 1s, 2s, 4s, 8s, 16s...
    const delayMs = Math.pow(2, attempt - 1) * this.BASE_RECONNECT_DELAY_MS;
    logger.info(`[Realtime] Scheduling retry ${attempt}/${this.MAX_RECONNECT_ATTEMPTS} for ${channelKey} in ${delayMs}ms (exponential backoff)`);

    const timer = setTimeout(() => {
      this.retryTimers.delete(channelKey);

      // Guard: Proceed only if the driver is still active and has not been cleaned up
      const activeKeys = this.driverToLocationChannels.get(driverId);
      if (activeKeys && activeKeys.has(channelKey)) {
        this.connectChannel(channelKey, driverId, displayId, attempt);
      } else {
        logger.info(`[Realtime] Suppressed retry for ${channelKey}; channel was removed during backoff`);
      }
    }, delayMs);

    this.retryTimers.set(channelKey, timer);
  }

  /**
   * Cleans up channel from Supabase client and local tracking map
   */
  cleanupChannel(channelKey) {
    const channel = this.locationChannels.get(channelKey);
    if (channel) {
      try {
        this.supabase.removeChannel(channel);
      } catch (err) {
        logger.error(`[Realtime] Error removing channel ${channelKey} from Supabase: ${err.message}`);
      }
      this.locationChannels.delete(channelKey);
    }
  }

  /**
   * Cancels pending retry timer for a channel
   */
  clearRetryTimer(channelKey) {
    if (this.retryTimers.has(channelKey)) {
      clearTimeout(this.retryTimers.get(channelKey));
      this.retryTimers.delete(channelKey);
    }
  }

  /**
   * Purges metadata map entries for a channel
   */
  purgeChannelMappings(channelKey, driverId, displayId) {
    if (driverId && this.driverToLocationChannels.has(driverId)) {
      const keys = this.driverToLocationChannels.get(driverId);
      keys.delete(channelKey);
      if (keys.size === 0) {
        this.driverToLocationChannels.delete(driverId);
      }
    }

    if (displayId && this.displayIdToLocationChannelKeys.has(displayId)) {
      const keys = this.displayIdToLocationChannelKeys.get(displayId);
      keys.delete(channelKey);
      if (keys.size === 0) {
        this.displayIdToLocationChannelKeys.delete(displayId);
      }
    }
  }

  /**
   * Unsubscribes and removes channels associated with a driver
   */
  removeDriverLocationChannels(driverId) {
    const channelKeys = this.driverToLocationChannels.get(driverId);
    if (!channelKeys) return;

    for (const channelKey of Array.from(channelKeys)) {
      this.clearRetryTimer(channelKey);
      this.cleanupChannel(channelKey);
      
      // Cleanup displayId map entries
      for (const [displayId, keys] of this.displayIdToLocationChannelKeys.entries()) {
        keys.delete(channelKey);
        if (keys.size === 0) {
          this.displayIdToLocationChannelKeys.delete(displayId);
        }
      }
    }

    this.driverToLocationChannels.delete(driverId);
    logger.info(`[Realtime] Cleaned up location channels and cancelled pending retries for driver: ${driverId}`);
  }

  /**
   * Completely cleans up all channels and pending retry timers
   */
  removeClientFromAllSubscriptions() {
    // 1. Clear all pending retry timers
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();

    // 2. Remove all channels from Supabase
    for (const channel of this.locationChannels.values()) {
      try {
        this.supabase.removeChannel(channel);
      } catch (err) {
        logger.error(`[Realtime] Error removing channel during full cleanup: ${err.message}`);
      }
    }

    // 3. Reset internal maps
    this.locationChannels.clear();
    this.driverToLocationChannels.clear();
    this.displayIdToLocationChannelKeys.clear();

    logger.info('[Realtime] Removed all subscriptions, cleared mappings, and cancelled pending retries');
  }

  handleLocationUpdate(driverId, displayId, payload) {
    // Payload handler logic
  }
}

export default RealtimeLocationManager;
