import GpsLog from "../models/GpsLog.js";

// Rate limiting & configuration defaults
const WS_UPGRADE_RATE_LIMIT = 5;
const WS_UPGRADE_RATE_WINDOW_SECONDS = 60;
const MAX_MSG_PER_SECOND = 10;

// Validate payload size from env: fallback to 4096 if non-positive or invalid
const parsedPayloadLimit = parseInt(process.env.WS_MAX_PAYLOAD_BYTES, 10);
const WS_MAX_PAYLOAD_BYTES =
  Number.isInteger(parsedPayloadLimit) && parsedPayloadLimit > 0
    ? parsedPayloadLimit
    : 4096;

// In-memory channel and timer mappings
const locationChannels = new Map();
const reconnectTimers = new Map();
const activeOrders = new Map();

/**
 * Handles reconnection attempts on Supabase channel errors or timeouts.
 * Cleans up existing SDK channel instances and prevents duplicate reconnect timers.
 */
const handleChannelRetry = (supabase, channel, orderUUID, backoffMs) => {
  // 1. Explicitly unsubscribe/remove channel from Supabase SDK instance before retrying
  if (channel) {
    supabase.removeChannel(channel).catch(() => {});
  }

  // 2. Clear existing local channel reference
  locationChannels.delete(orderUUID);

  // 3. Clear any preexisting pending retry timer for this order
  if (reconnectTimers.has(orderUUID)) {
    clearTimeout(reconnectTimers.get(orderUUID));
    reconnectTimers.delete(orderUUID);
  }

  // 4. Schedule reconnection and track the timer reference
  const timerId = setTimeout(() => {
    reconnectTimers.delete(orderUUID);
    // Ensure order is still active before attempting reconnection
    if (activeOrders.has(orderUUID)) {
      connectChannel(orderUUID);
    }
  }, backoffMs);

  reconnectTimers.set(orderUUID, timerId);
};

/**
 * Safely removes driver location channels and cancels any pending retry timers.
 */
export const removeDriverLocationChannels = (orderUUID) => {
  // Cancel pending retry timer if one exists
  if (reconnectTimers.has(orderUUID)) {
    clearTimeout(reconnectTimers.get(orderUUID));
    reconnectTimers.delete(orderUUID);
  }

  // Remove active Supabase channel
  const channel = locationChannels.get(orderUUID);
  if (channel) {
    supabase.removeChannel(channel).catch(() => {});
    locationChannels.delete(orderUUID);
  }
};

/**
 * Establishes and binds channel handlers for a given order.
 */
export const connectChannel = (orderUUID, reconnectAttempts = 1) => {
  if (!activeOrders.has(orderUUID)) return;

  const channel = supabase.channel(`location:${orderUUID}`);

  channel
    .on("broadcast", { event: "location_update" }, async (payload) => {
      if (payload && payload.lat != null && payload.lng != null) {
        try {
          await GpsLog.create({
            bookingId: orderUUID,
            driverId: payload.driverId || "unknown",
            lat: payload.lat,
            lng: payload.lng,
            speed: payload.speed ?? null,
            heading: payload.heading ?? null,
            timestamp: payload.timestamp ? new Date(payload.timestamp) : new Date(),
          });
        } catch (err) {
          console.error(`Failed to log GPS telemetry for order ${orderUUID}:`, err);
        }
      }
    })
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        const backoffMs = reconnectAttempts * 1000;
        console.warn(
          `Supabase Realtime channel error for order ${orderUUID}. Retrying in ${backoffMs}ms...`
        );
        handleChannelRetry(supabase, channel, orderUUID, backoffMs);
      }
    });

  locationChannels.set(orderUUID, channel);
};

export const attachTrackerSocket = (server) => {
  console.log(
    `Tracker WebSocket initialized with max payload: ${WS_MAX_PAYLOAD_BYTES} bytes`
  );
};

export default attachTrackerSocket;
