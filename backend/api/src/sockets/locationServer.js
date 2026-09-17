import { Server } from "socket.io";
import logger from "../middleware/logger.js";
import { verifyAuthToken } from "../middleware/auth.js";
import { supabase, redisClient } from "../config/db.js";
import telemetryBuffer from "./telemetryBuffer.js";
import { CLOCK_SKEW_TOLERANCE_MS } from "./tracker.js";

let io = null;
let _orderRepository = null;

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

/**
 * Parses a client-supplied GPS timestamp defensively.
 *
 * Falls back to the current time when the value is missing or unparseable so
 * that a single malformed telemetry frame (e.g. `"abc"` or a bad epoch)
 * cannot turn into an Invalid Date whose `toISOString()` throws and kills the
 * driver's live location broadcast.
 */
export function parseGpsTimestamp(timestamp) {
  const parsed = timestamp ? new Date(timestamp) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/**
 * Atomic compare-and-set for the driver sequence gate.
 *
 * KEYS[1] = driver:sequence:{driverId}
 * ARGV[1] = incoming GPS epoch (ms since Unix epoch)
 *
 * Returns 1 when the incoming epoch is accepted (key advanced or first
 * write), 0 when rejected (stale or duplicate). Runs as a single Redis
 * command, so concurrent callers can never race a stale read past a newer
 * write.
 */
const SEQUENCE_GATE_LUA = `
local key      = KEYS[1]
local incoming = tonumber(ARGV[1])

-- Defensive: a non-numeric ARGV would make incoming nil; accept (fail-open)
-- rather than erroring inside the script and failing the caller closed.
if not incoming then
  return 1
end

local current = tonumber(redis.call('GET', key))

if current and incoming <= current then
  return 0
end

redis.call('SET', key, tostring(incoming), 'EX', 86400)
return 1
`;

/**
 * Idempotency / out-of-order sequence gate for the Socket.IO location path.
 *
 * Mirrors the ordering guarantee of the tracker path so both live-location
 * WebSocket paths drop stale/duplicate GPS points against the SAME key
 * (`driver:sequence:{driverId}`): a driver switching between WS transports
 * cannot replay stale points on either connection.
 *
 * Concurrency: the read-compare-write is a single atomic Lua script (EVAL),
 * not a GET→compare→SET round-trip. GET→SET is a TOCTOU race — two callers
 * can read the same stale snapshot and the older GPS timestamp can overwrite
 * a newer one. A Lua script executes as one uninterruptible Redis command,
 * so the compare-and-set cannot interleave with another caller's.
 *
 * Semantics:
 *  - Key: `driver:sequence:{driverId}` (24h TTL, refreshed on each write).
 *  - Incoming epoch > stored epoch (or no stored epoch) → store and accept.
 *  - Incoming epoch ≤ stored epoch → reject (stale or exact duplicate).
 *  - Redis unavailable or errored → fail-open (accept) so an outage never
 *    blocks live location broadcasting.
 *
 * @param {string} driverId
 * @param {Date}   gpsTimestamp - the parsed client GPS timestamp
 * @returns {Promise<boolean>} true → accept; false → drop (stale/duplicate)
 */
export async function applySequenceGate(driverId, gpsTimestamp) {
  if (!redisClient) return true; // fail-open: no Redis configured

  try {
    const seqKey = `driver:sequence:${driverId}`;
    const incomingEpoch = gpsTimestamp.getTime();

    // Atomic compare-and-set: the script runs as ONE uninterruptible Redis
    // command. Concurrent location_update frames cannot interleave between
    // the read and the write, so an older GPS timestamp can never overwrite
    // a newer one (the race the previous GET→SET version allowed).
    // ioredis signature: eval(script, numKeys, key, ...args).
    const result = await redisClient.eval(SEQUENCE_GATE_LUA, 1, seqKey, incomingEpoch);

    if (result === 0) {
      logger.warn(
        { driverId, incomingEpoch },
        '[WS][locationServer] Out-of-order/duplicate GPS point dropped'
      );
      return false;
    }

    return true;
  } catch (err) {
    // Redis error: fail-open so a transient outage never blocks broadcasting.
    logger.error({ driverId, err: err.message }, '[WS][locationServer] Sequence gate Redis error — failing open');
    return true;
  }
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
     *
     * Persistence is decoupled from broadcasting: the GPS point is pushed into
     * the shared buffered telemetry pipeline (synchronous, fail-open) and the
     * live `driver_location` broadcast proceeds immediately without waiting on
     * any MongoDB round-trip.
     */
    socket.on("location_update", async (payload) => {
      // Treat any incoming data as proof-of-life (avoids evicting an active
      // driver who sends location updates but whose pong was dropped).
      const entry = activeDrivers.get(socket.id);
      if (entry) entry.lastPong = Date.now();

      const { lat, lng, speed = 0, heading = 0, timestamp } = payload || {};

      if (
        typeof lat !== "number" ||
        typeof lng !== "number" ||
        lat < -90 || lat > 90 ||
        lng < -180 || lng > 180
      ) {
        socket.emit("error", { message: "Invalid GPS coordinates" });
        return;
      }

      // Parse the client GPS timestamp. This is the canonical ordering key:
      // newer GPS timestamps represent newer positions so we compare them
      // against the driver's stored sequence to detect stale/duplicate updates.
      const gpsTimestamp = parseGpsTimestamp(timestamp);

      // Clock skew validation — mirrors tracker.js::handleLocationPing (#596).
      // A device clock outside the allowed window would poison the ordering
      // key, so drop the frame BEFORE the sequence gate: a rejected timestamp
      // must never advance the Redis `driver:sequence:{driverId}` key.
      // Same rule as tracker.js: symmetric absolute skew, rejected only when
      // STRICTLY greater than CLOCK_SKEW_TOLERANCE_MS (the exact boundary is
      // accepted); parseGpsTimestamp() already falls back to server time for
      // missing or malformed timestamps.
      const skewMs = Math.abs(gpsTimestamp.getTime() - Date.now());
      if (skewMs > CLOCK_SKEW_TOLERANCE_MS) {
        logger.warn(
          { driverId, skewMs, toleranceMs: CLOCK_SKEW_TOLERANCE_MS },
          `[WS][locationServer] GPS timestamp clock skew ${skewMs}ms exceeds tolerance ${CLOCK_SKEW_TOLERANCE_MS}ms — ignoring update.`
        );
        return;
      }

      // Out-of-order / duplicate guard (mirrors tracker.js::handleLocationPing).
      // Fails open when Redis is unavailable so a Redis outage never blocks
      // live location broadcasting.
      const accepted = await applySequenceGate(driverId, gpsTimestamp);
      if (!accepted) return;

      // 1. Buffer GPS point into the shared telemetry pipeline. Synchronous and
      //    fail-open — a slow or unavailable MongoDB must never delay the
      //    broadcast below.
      try {
        telemetryBuffer.enqueue({
          driver_id: driverId,
          order_id: socket.data.orderId || null,
          order_display_id: bookingId,
          lat,
          lng,
          location: {
            type: "Point",
            coordinates: [lng, lat],
          },
          speed_kmh: speed,
          bearing_deg: heading,
          timestamp: gpsTimestamp,
          pinged_at: gpsTimestamp,
          buffered_at: new Date(),
          server_received_at: new Date(),
        });
      } catch (error) {
        logger.error({ driverId, error: error.message }, '[WS] GPS buffer error (broadcast continues)');
      }

      // 2. Broadcast to customer's booking room — independent of persistence.
      try {
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
        logger.error({ driverId, error: error.message }, '[WS] GPS broadcast error for driver');
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

        // Send the last known GPS position immediately on subscribe. Read from
        // the shared `telemetry` collection (the buffered pipeline) rather than
        // the legacy GpsLog collection.
        const lastPoint = await telemetryBuffer.readLatestPoint(bookingId);

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

    const profile = await verifyAuthToken(token);

    if (profile.role !== "driver") {
      return next(new Error("Forbidden: driver role required"));
    }

    const bookingId = socket.handshake.auth.bookingId;
    if (!bookingId) {
      return next(new Error("bookingId required in handshake auth"));
    }

    const orderId = await verifyDriverAssignment(profile.id, bookingId);
    if (!orderId) {
      return next(new Error("Forbidden: driver is not assigned to this booking"));
    }

    socket.data.driverId = profile.id;
    socket.data.bookingId = bookingId;
    // Orders UUID, resolved once per connection (not per location update) so
    // telemetry records carry a stable `order_id`.
    socket.data.orderId = orderId;

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
 * Resolves to the orders UUID (or null when not assigned / on error).
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

    if (error || !data) return null;
    return data.id;
  } catch (err) {
    logger.error({ err }, '[WS] verifyDriverAssignment error');
    return null;
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

/**
 * Broadcasts an ETA update to customers subscribed to a booking room.
 * Mirrors the tracker.js `eta_update` event payload for Socket.IO clients.
 */
export function emitEtaUpdateToBooking(bookingId, eta) {
  if (!io || !bookingId || !eta) return;

  try {
    io.of("/customer")
      .to(`booking:${bookingId}`)
      .emit("eta_update", {
        eta,
        bookingId,
        timestamp: new Date().toISOString(),
      });
  } catch (error) {
    logger.error({ bookingId, error: error.message }, '[WS] ETA broadcast error');
  }
}

export async function closeLocationServer() {
  stopHeartbeatSweep();
  if (io) {
    io.close();
    io = null;
  }
}
