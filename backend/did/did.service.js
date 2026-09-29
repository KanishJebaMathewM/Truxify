/**
 * Tracker socket handler for real-time order location updates.
 */
class Tracker {
    constructor(io, supabase) {
        this.io = io;
        this.supabase = supabase;
        this.locationChannels = new Map(); // orderUUID -> channel instance
        this.retryTimers = new Map();     // orderUUID -> timer handle
    }

    /**
     * Clears pending retry timers and removes Supabase channels cleanly.
     * @param {string} orderUUID 
     */
    _removeLocationChannel(orderUUID) {
        // Cancel any pending retry timer for this order
        if (this.retryTimers.has(orderUUID)) {
            clearTimeout(this.retryTimers.get(orderUUID));
            this.retryTimers.delete(orderUUID);
        }

        const channel = this.locationChannels.get(orderUUID);
        if (channel) {
            this.supabase.removeChannel(channel);
            this.locationChannels.delete(orderUUID);
        }
    }

    /**
     * Connects or reconnects to a location tracking channel for a specific order.
     * @param {string} orderUUID 
     * @param {number} backoffMs 
     */
    connectChannel(orderUUID, backoffMs = 1000) {
        // If channel already exists and is active, do nothing
        if (this.locationChannels.has(orderUUID)) {
            return;
        }

        const channelName = `order-location:${orderUUID}`;
        const channel = this.supabase.channel(channelName);

        channel
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'orders',
                filter: `id=eq.${orderUUID}`
            }, (payload) => {
                this.io.to(`order:${orderUUID}`).emit('locationUpdate', payload.new);
            })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    // Successfully connected; clear any pending retry timer
                    if (this.retryTimers.has(orderUUID)) {
                        clearTimeout(this.retryTimers.get(orderUUID));
                        this.retryTimers.delete(orderUUID);
                    }
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    // Clean up failed channel
                    this.supabase.removeChannel(channel);

                    // Only delete from cache if channel identity matches
                    if (this.locationChannels.get(orderUUID) === channel) {
                        this.locationChannels.delete(orderUUID);
                    }

                    // Clear existing timer if any before setting new backoff
                    if (this.retryTimers.has(orderUUID)) {
                        clearTimeout(this.retryTimers.get(orderUUID));
                    }

                    // Schedule retry with exponential backoff
                    const nextBackoff = Math.min(backoffMs * 2, 30000);
                    const timerId = setTimeout(() => {
                        this.retryTimers.delete(orderUUID);
                        // Ensure channel is still desired before attempting reconnection
                        if (!this.locationChannels.has(orderUUID)) {
                            this.connectChannel(orderUUID, nextBackoff);
                        }
                    }, backoffMs);

                    this.retryTimers.set(orderUUID, timerId);
                }
            });

        this.locationChannels.set(orderUUID, channel);
    }

    /**
     * Unsubscribes driver or client from an order location channel.
     * @param {string} orderUUID 
     */
    unsubscribeChannel(orderUUID) {
        this._removeLocationChannel(orderUUID);
    }

    /**
     * Cleanup socket connections on disconnect.
     */
    handleDisconnect() {
        for (const orderUUID of Array.from(this.locationChannels.keys())) {
            this._removeLocationChannel(orderUUID);
        }
    }
}

export default Tracker;
