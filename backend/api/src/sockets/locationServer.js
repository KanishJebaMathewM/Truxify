import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import logger from "../middleware/logger.js";
import { GpsLog } from "../models/GpsLog.js";
import { supabase } from "../config/db.js";

let io = null;

/**
 * Initializes the Truxify Live Location WebSocket server on top of an existing
 * Node.js HTTP server. Should be called once during startup after MongoDB
 * is available.
 *
 * Architecture:
 *  /driver namespace — Driver app sends GPS updates here
 *  /customer namespace — Customer app subscribes to booking rooms here
 *
 * Auth:
 *  Both namespaces require a valid JWT in socket.handshake.auth.token
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
    // Reconnection settings for mobile clients (drivers on the road)
    pingTimeout: 30000,
    pingInterval: 10000,
  });

  // ─── Driver Namespace ────────────────────────────────────────────────────
  const driverNs = io.of("/driver");

  driverNs.use(verifyDriverToken);

  driverNs.on("connection", (socket) => {
    const { driverId, bookingId } = socket.data;

    logger.info(`[WS] Driver ${driverId} connected for booking ${bookingId}`);

    // Join their booking room (for server-side routing)
    socket.join(`driver:${driverId}`);

    /**
     * Receives GPS coordinate from the driver's Flutter app.
     *
     * Expected payload:
     * {
     *   bookingId: string,
     *   lat: number,        // -90 to 90
     *   lng: number,        // -180 to 180
     *   speed: number,      // km/h
     *   heading: number,    // 0–360 degrees
     *   timestamp: string   // ISO 8601
     * }
     */
    socket.on("location_update", async (payload) => {
      try {
        // Validate payload
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
    });

    socket.on("error", (error) => {
      logger.error({ driverId, error: error.message }, `[WS] Driver socket error`);
    });
  });

  // ─── Customer Namespace ──────────────────────────────────────────────────
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

  logger.info("[WS] Truxify Location Server attached (/driver + /customer)");

  return io;
}

// ─── Auth Middleware ─────────────────────────────────────────────────────────

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

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== "driver") {
      return next(new Error("Forbidden: driver role required"));
    }

    const bookingId = socket.handshake.auth.bookingId;
    if (!bookingId) {
      return next(new Error("bookingId required in handshake auth"));
    }

    // Verify this driver is actually assigned to the booking before trusting
    // any GPS data submitted under it — mirrors the ownership check already
    // performed on the customer namespace (see verifyBookingOwnership below).
    const isAssignedDriver = await verifyDriverAssignment(decoded.sub, bookingId);
    if (!isAssignedDriver) {
      return next(new Error("Forbidden: driver is not assigned to this booking"));
    }

    socket.data.driverId = decoded.sub;
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

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== "customer") {
      return next(new Error("Forbidden: customer role required"));
    }

    socket.data.customerId = decoded.sub;
    next();
  } catch (error) {
    next(new Error(`Authentication failed: ${error.message}`));
  }
}

/**
 * Verifies that a driver is assigned to a specific booking.
 * Queries Supabase PostgreSQL via the existing database client.
 */
async function verifyDriverAssignment(driverId, bookingId) {
  try {
    const { data, error } = await supabase
      .from("bookings")
      .select("id")
      .eq("id", bookingId)
      .eq("driver_id", driverId)
      .single();

    if (error || !data) return false;
    return true;
  } catch (err) {
    logger.error({ err }, '[WS] verifyDriverAssignment error');
    return false;
  }
}

/**
 * Verifies that a customer owns a specific booking.
 * Queries Supabase PostgreSQL via the existing database client.
 */
async function verifyBookingOwnership(customerId, bookingId) {
  try {
    // Use Supabase client from existing db module

    const { data, error } = await supabase
      .from("bookings")
      .select("id")
      .eq("id", bookingId)
      .eq("customer_id", customerId)
      .single();

    if (error || !data) return false;
    return true;
  } catch (err) {
    logger.error({ err }, '[WS] isCustomerAuthorized error');
    return false;
  }
}

export async function closeLocationServer() {
  if (io) {
    io.close();
    io = null;
  }
}
