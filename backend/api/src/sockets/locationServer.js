import { Server } from "socket.io";
import logger from "../middleware/logger.js";
import { verifyAuthToken } from "../middleware/auth.js";
import { GpsLog } from "../models/GpsLog.js";
import { supabase } from "../config/db.js";

let io = null;

// ─── Heartbeat / dead-connection sweep ───────────────────────────────────────

/**
 * How often the server pings every connected driver socket (ms).
 * Chosen to be shorter than Socket.IO's own pingInterval so that
 * application-level zombie detection fires before the transport times out.
 */
const HEARTBEAT_INTERVAL_MS = Number(process.env.WS_HEARTBEAT_INTERVAL_MS) || 15_000;

/**
 * How long to wait for a pong after emitting a ws_ping before treating the
 * socket as dead and forcefully disconnecting it (ms).
 */
const HEARTBEAT_TIMEOUT_MS = Number(process.env.WS_HEARTBEAT_TIMEOUT_MS) || 20_000;

/**
 * Registry of all currently-connected driver sockets.
 *
 *   key   → socket.id
 *   value → { driverId, bookingId, socket, lastPong: Date }
 *
 * Used by the sweep timer to identify and evict dead connections that the
 * Socket.IO transport-level ping missed (e.g. mobile NAT timeouts that hold
 * the TCP socket half-open without sending a RST).
 */
const activeDrivers = new Map();

/** Reference to the sweep setInterval so we can cancel it on shutdown. */
let heartbeatTimer = null;

/**
 * Starts the heartbeat sweep loop.
 * Emits `ws_ping` to every registered driver socket; any socket that has not
 * responded with `ws_pong` within HEARTBEAT_TIMEOUT_MS is forcefully
 * disconnected and removed from the registry.
 */
function startHeartbeatSweep() {
  if (heartbeatTimer) return; // idempotent

  heartbeatTimer = setInterval(() => {
    const now = Date.now();

    for (const [socketId, entry] of activeDrivers) {
      const { driverId, socket, lastPong } = entry;
      const age = now - lastPong;

      if (age > HEARTBEAT_INTERVAL_MS + HEARTBEAT_TIMEOUT_MS) {
        // No pong received in time — treat as dead connection.
        logger.warn(
          { driverId, socketId, staleSinceMs: age },
          '[WS][heartbeat] Evicting unresponsive driver socket'
        );
        socket.disconnect(true);
        activeDrivers.delete(socketId);
        continue;
      }

      // Send application-level ping — client should reply with 'ws_pong'.
      socket.emit('ws_ping');
    }

    logger.debug(
      { activeCount: activeDrivers.size },
      '[WS][heartbeat] Sweep complete'
    );
  }, HEARTBEAT_INTERVAL_MS);

  // Don't let this timer keep the process alive if everything else has shut down.
  heartbeatTimer.unref?.();
}

/**
 * Stops the heartbeat sweep loop and clears the active-driver registry.
 * Called from closeLocationServer().
 */
function stopHeartbeatSweep() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  activeDrivers.clear();
}

// ─── Public helpers ──────────────────────────────────────────────────────────

/** Returns the number of currently-tracked live driver connections. */
export function getActiveDriverCount() {
  return activeDrivers.size;
}

// ─── Server init ─────────────────────────────────────────────────────────────

/**
 * Initializes the Truxify Live Location WebSocket server on top of an existing
 * Node.js HTTP server. Should be called once during startup after MongoDB
 * is available.
 *
 * Architecture:
 *  /driver namespace   — Driver app sends GPS updates here
 *  /customer namespace — Customer app subscribes to booking rooms here
 *
 * Auth:
 *  Both namespaces require a valid Firebase/Supabase token in socket.handshake.auth.token
 *
 * Dead-connection handling (issue #5728):
 *  In addition to Socket.IO's transport-level ping/pong (pingInterval /
 *  pingTimeout), an application-level heartbeat sweep runs every
 *  HEARTBEAT_INTERVAL_MS.  Each driver socket is registered in `activeDrivers`
 *  with a `lastPong` timestamp; the sweep emits `ws_ping` and evicts any
 *  socket whose `lastPong` age exceeds HEARTBEAT_INTERVAL_MS +
 *  HEARTBEAT_TIMEOUT_MS.  This catches TCP half-open connections that survive
 *  the transport-level ping (common on mobile LTE/NAT transitions).
 *
 * Flow:
 *  Driver emits "location_update" →
 *  Server persists to MongoDB (GpsLog) →
 *  Server broadcasts "driver_location" to booking:{id} room →
 *  Customer receives update → Leaflet marker moves
 *
 * @param {import("http").Server} httpServer - Existing HTTP server instance
 */
export function initLocationServer(httpServer) {
  if (io) {
    logger.warn('[initLocationServer] Already initialized — skipping duplicate call.');
    return;
  }

  io = new Server(httpServer, {
    cors: {
      origin: process.env.ALLOWED_ORIGINS?.split(",") || (
        process.env.NODE_ENV === 'production'
          ? []
          : ["http://localhost:3000", "http://localhost:5000"]
      ),
      methods: ["GET", "POST"],
      credentials: true,
    },
    // Transport-level heartbeat — first line of defence for dead connections.
    // pingInterval: how often engine.io sends a ping frame (ms).
    // pingTimeout:  how long to wait for a pong before closing (ms).
    // Tuned to be more aggressive than the defaults (25 000 / 20 000) so that
    // stale mobile connections are reclaimed sooner.
    pingInterval: 10_000,
    pingTimeout:  25_000,
  });

  // ─── Driver Namespace ─────────────────────────────────────────────────────
  const driverNs = io.of("/driver");

  driverNs.use(verifyDriverToken);

  driverNs.on("connection", (socket) => {
    const { driverId, bookingId } = socket.data;

    logger.info(`[WS] Driver ${driverId} connected for booking ${bookingId}`);

    // Join their booking room (for server-side routing)
    socket.join(`driver:${driverId}`);

    // ── Register in the active-driver map ─────────────────────────────────
    activeDrivers.set(socket.id, {
      driverId,
      bookingId,
      socket,
      lastPong: Date.now(),
    });

    // Client should reply to every 'ws_ping' with 'ws_pong'.
    // Receiving a pong resets the liveness clock for this socket.
    socket.on('ws_pong', () => {
      const entry = activeDrivers.get(socket.id);
      if (entry) {
        entry.lastPong = Date.now();
      }
    });

    /**
     * Receives GPS coordinate from the driver's Flutter app.
     *
     * Expected payload:
     * {
     *   lat: number,        // -90 to 90
     *   lng: number,        // -180 to 180
     *   speed: number,      // km/h
     *   heading: number,    // 0–360 degrees
     *   timestamp: string   // ISO 8601
     * }
     *
     * Note: bookingId is taken from the authenticated socket session,
     * NOT from the payload, to prevent unauthorized location updates.
     */
    socket.on("location_update", async (payload) => {
      // Treat any incoming data as proof-of-life (avoids evicting an active
      // driver who sends location updates but whose pong was dropped).
      const entry = activeDrivers.get(socket.id);
      if (entry) entry.lastPong = Date.now();

      try {
        const { lat, lng, speed = 0, heading = 0, timestamp } = payload;

        if (
          typeof lat !== "number" ||
          typeof lng !== "number" ||
          lat < -90 || lat > 90 ||
          lng < -180 || lng > 180
        ) {
          socket.emit("error", { message: "Invalid GPS coordinates" });
          return;
        }

        const gpsTimestamp = timestamp ? new Date(timestamp) : new Date();

        // 1. Persist GPS point to MongoDB time-series collection
        // Use authenticated bookingId from socket, NOT from payload
        await GpsLog.create({
          bookingId,
          driverId,
          lat,
          lng,
          speed,
          heading,
          timestamp: gpsTimestamp,
        });

        // 2. Broadcast to customer's booking room
        // Use authenticated bookingId from socket, NOT from payload
        io.of("/customer")
          .to(`booking:${bookingId}`)
          .emit("driver_location", {
            lat,
            lng,
            speed,
            heading,
            timestamp: gpsTimestamp.toISOString(),
            bookingId,
          });

      } catch (error) {
        logger.error({ driverId, error: error.message }, '[WS] GPS persist error for driver');
        socket.emit("error", { message: "Failed to process location update" });
      }
    });

    socket.on("disconnect", (reason) => {
      logger.info(`[WS] Driver ${driverId} disconnected: ${reason}`);
      // Always remove from the active-driver registry on any disconnect so the
      // heartbeat sweep doesn't try to ping an already-closed socket.
      activeDrivers.delete(socket.id);
    });

    socket.on("error", (error) => {
      logger.error({ driverId, error: error.message }, `[WS] Driver socket error`);
    });
  });

  // ─── Customer Namespace ───────────────────────────────────────────────────
  const customerNs = io.of("/customer");

  customerNs.use(verifyCustomerToken);

  customerNs.on("connection", (socket) => {
    const { customerId } = socket.data;

    logger.info(`[WS] Customer ${customerId} connected`);

    /**
     * Customer subscribes to a specific booking's live location.
     * Server verifies the customer owns this booking before joining the room.
     *
     * Expected payload: { bookingId: string }
     */
    socket.on("subscribe_booking", async (payload) => {
      try {
        const { bookingId } = payload;

        if (!bookingId) {
          socket.emit("error", { message: "bookingId required" });
          return;
        }

        // Verify this customer owns the booking (Supabase lookup)
        const isOwner = await verifyBookingOwnership(customerId, bookingId);
        if (!isOwner) {
          socket.emit("error", {
            message: "Unauthorised: You do not own this booking",
          });
          return;
        }

        // Join the booking room to receive location updates
        socket.join(`booking:${bookingId}`);

        // Send the last known GPS position immediately on subscribe
        const lastPoint = await GpsLog.findOne(
          { bookingId },
          {},
          { sort: { timestamp: -1 } }
        );

        if (lastPoint) {
          socket.emit("driver_location", {
            lat: lastPoint.lat,
            lng: lastPoint.lng,
            speed: lastPoint.speed,
            heading: lastPoint.heading,
            timestamp: lastPoint.timestamp.toISOString(),
            bookingId,
          });
        }

        socket.emit("subscribed", { bookingId });

      } catch (error) {
        logger.error({ customerId, error: error.message }, '[WS] Subscribe error for customer');
        socket.emit("error", { message: "Failed to subscribe to booking" });
      }
    });

    socket.on("unsubscribe_booking", ({ bookingId }) => {
      socket.leave(`booking:${bookingId}`);
    });

    socket.on("disconnect", (reason) => {
      logger.info(`[WS] Customer ${customerId} disconnected: ${reason}`);
    });
  });

  // ─── Start the application-level heartbeat sweep ─────────────────────────
  startHeartbeatSweep();

  logger.info(
    { heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS, heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS },
    "[WS] Truxify Location Server attached (/driver + /customer) with heartbeat sweep"
  );

  return io;
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────

/**
 * Socket.IO middleware for driver namespace authentication.
 * Verifies JWT and extracts driverId + bookingId.
 */
async function verifyDriverToken(socket, next) {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Authentication required: no token provided"));
    }

    // In BYPASS_AUTH mode (local dev), skip verification
    if (process.env.BYPASS_AUTH === "true" && process.env.NODE_ENV !== "production") {
      socket.data.driverId = socket.handshake.auth.driverId || "dev-driver";
      socket.data.bookingId = socket.handshake.auth.bookingId || "dev-booking";
      return next();
    }

    const profile = await verifyAuthToken(token);

    if (profile.role !== "driver") {
      return next(new Error("Forbidden: driver role required"));
    }

    const bookingId = socket.handshake.auth.bookingId;
    if (!bookingId) {
      return next(new Error("bookingId required in handshake auth"));
    }

    const isAssignedDriver = await verifyDriverAssignment(profile.id, bookingId);
    if (!isAssignedDriver) {
      return next(new Error("Forbidden: driver is not assigned to this booking"));
    }

    socket.data.driverId = profile.id;
    socket.data.bookingId = bookingId;

    next();
  } catch (error) {
    next(new Error(`Authentication failed: ${error.message}`));
  }
}

/**
 * Socket.IO middleware for customer namespace authentication.
 */
async function verifyCustomerToken(socket, next) {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Authentication required: no token provided"));
    }

    if (process.env.BYPASS_AUTH === "true" && process.env.NODE_ENV !== "production") {
      socket.data.customerId = socket.handshake.auth.customerId || "dev-customer";
      return next();
    }

    const profile = await verifyAuthToken(token);

    if (profile.role !== "customer") {
      return next(new Error("Forbidden: customer role required"));
    }

    socket.data.customerId = profile.id;
    next();
  } catch (error) {
    next(new Error(`Authentication failed: ${error.message}`));
  }
}

/**
 * Verifies that a driver is assigned to a specific booking.
 */
async function verifyDriverAssignment(driverId, bookingId) {
  try {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isUuid = uuidRegex.test(bookingId);

    let query = supabase
      .from("orders")
      .select("id")
      .eq("driver_id", driverId);
    query = isUuid ? query.eq("id", bookingId) : query.eq("order_display_id", bookingId);

    const { data, error } = await query.maybeSingle();

    if (error || !data) return false;
    return true;
  } catch (err) {
    logger.error({ err }, '[WS] verifyDriverAssignment error');
    return false;
  }
}

/**
 * Verifies that a customer owns a specific booking.
 */
async function verifyBookingOwnership(customerId, bookingId) {
  try {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isUuid = uuidRegex.test(bookingId);

    let query = supabase
      .from("orders")
      .select("id")
      .eq("customer_id", customerId);
    query = isUuid ? query.eq("id", bookingId) : query.eq("order_display_id", bookingId);

    const { data, error } = await query.maybeSingle();

    if (error || !data) return false;
    return true;
  } catch (err) {
    logger.error({ err }, '[WS] isCustomerAuthorized error');
    return false;
  }
}

export async function closeLocationServer() {
  stopHeartbeatSweep();
  if (io) {
    io.close();
    io = null;
  }
}
