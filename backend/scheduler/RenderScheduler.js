import logger from '../api/src/middleware/logger.js';

class LocationChannelManager {
    constructor(supabaseClient) {
        this.supabase = supabaseClient;
        this.locationChannels = new Map(); // Key: driverId, Value: Channel
        this.retryTimers = new Map();       // Key: driverId, Value: Timer handle
        this.maxRetries = 5;
        this.baseDelayMs = 1000;
    }

    /**
     * Connects or reconnects to a driver location channel
     */
    connectChannel(driverId, attempt = 1) {
        // Clear any existing pending retry timer for this driver
        this.clearRetryTimer(driverId);

        // If a channel already exists, unsubscribe and clean it up before recreating
        if (this.locationChannels.has(driverId)) {
            this.cleanupChannel(driverId);
        }

        const channelName = `driver-location:${driverId}`;
        const channel = this.supabase.channel(channelName);

        channel
            .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations' }, (payload) => {
                this.handleLocationUpdate(driverId, payload);
            })
            .subscribe((status, err) => {
                if (status === 'SUBSCRIBED') {
                    logger.info(`Successfully subscribed to location channel for driver ${driverId}`);
                    this.clearRetryTimer(driverId);
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    logger.warn(`Channel error for driver ${driverId}: ${err?.message || status}`);
                    this.handleChannelFailure(driverId, attempt);
                }
            });

        this.locationChannels.set(driverId, channel);
    }

    /**
     * Handles retry with linear backoff and timer tracking
     */
    handleChannelFailure(driverId, attempt) {
        // Explicitly remove and unsubscribe the failed channel
        this.cleanupChannel(driverId);

        if (attempt > this.maxRetries) {
            logger.error(`Max retries (${this.maxRetries}) reached for driver ${driverId}. Disconnecting channel.`);
            return;
        }

        // Linear backoff delay calculation
        const delayMs = this.baseDelayMs * attempt;
        logger.info(`Scheduling reconnect for driver ${driverId} in ${delayMs}ms using linear backoff (attempt ${attempt}/${this.maxRetries})`);

        const timer = setTimeout(() => {
            this.retryTimers.delete(driverId);
            // Guard against stale callbacks if cleanup happened during delay
            if (this.shouldReconnect(driverId)) {
                this.connectChannel(driverId, attempt + 1);
            }
        }, delayMs);

        this.retryTimers.set(driverId, timer);
    }

    /**
     * Checks if reconnection should proceed
     */
    shouldReconnect(driverId) {
        // Customize check based on application state if needed
        return true;
    }

    /**
     * Unsubscribes and deletes a single channel safely
     */
    cleanupChannel(driverId) {
        const channel = this.locationChannels.get(driverId);
        if (channel) {
            try {
                channel.unsubscribe();
            } catch (err) {
                logger.error(`Error unsubscribing channel for driver ${driverId}: ${err.message}`);
            }
            this.locationChannels.delete(driverId);
        }
    }

    /**
     * Clears pending retry timers for a specific driver
     */
    clearRetryTimer(driverId) {
        if (this.retryTimers.has(driverId)) {
            clearTimeout(this.retryTimers.get(driverId));
            this.retryTimers.delete(driverId);
        }
    }

    /**
     * Removes specific driver location channels and cancels any pending retries
     */
    removeDriverLocationChannels(driverId) {
        this.clearRetryTimer(driverId);
        this.cleanupChannel(driverId);
        logger.info(`Removed location channel and cancelled retries for driver ${driverId}`);
    }

    /**
     * Completely cleans up all active subscriptions and pending retry timers
     */
    removeClientFromAllSubscriptions() {
        // 1. Cancel all active retry timers
        for (const [driverId, timer] of this.retryTimers.entries()) {
            clearTimeout(timer);
        }
        this.retryTimers.clear();

        // 2. Unsubscribe all channels
        for (const [driverId, channel] of this.locationChannels.entries()) {
            try {
                channel.unsubscribe();
            } catch (err) {
                logger.error(`Error unsubscribing channel for driver ${driverId} during complete cleanup: ${err.message}`);
            }
        }
        this.locationChannels.clear();

        logger.info('Successfully removed all client subscriptions and cancelled pending retries.');
    }

    handleLocationUpdate(driverId, payload) {
        // Payload processing logic
    }
}

export default LocationChannelManager;
