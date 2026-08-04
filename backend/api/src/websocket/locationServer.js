const { Server } = require("socket.io");
const GpsLog = require("../models/GpsLog");
const jwt = require("jsonwebtoken");

function verifyToken(token, secret) {
  try {
    return jwt.verify(token, secret);
  } catch {
    return null;
  }
}

function attachLocationServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.ALLOWED_ORIGINS?.split(",") || [],
      methods: ["GET", "POST"],
    },
  });

  // --- Driver namespace ---
  const driverNs = io.of("/driver");
  driverNs.on("connection", (socket) => {
    const decoded = verifyToken(
      socket.handshake.auth.token,
      process.env.JWT_SECRET
    );
    if (!decoded) return socket.disconnect(true);

    const driverId = decoded.sub;

    socket.on("location_update", async (payload) => {
      const { bookingId, lat, lng, timestamp, speed, heading } = payload;
      if (!bookingId || lat == null || lng == null) return;

      try {
        await GpsLog.create({
          bookingId,
          driverId,
          lat,
          lng,
          speed: speed ?? null,
          heading: heading ?? null,
          timestamp: timestamp ? new Date(timestamp) : new Date(),
        });

        io.of("/customer")
          .to(`booking:${bookingId}`)
          .emit("driver_location", { lat, lng, timestamp, heading });
      } catch (err) {
        console.error("GPS log error:", err.message);
      }
    });

    socket.on("disconnect", () => {
      console.log(`Driver ${driverId} disconnected`);
    });
  });

  // --- Customer namespace ---
  const customerNs = io.of("/customer");
  customerNs.on("connection", (socket) => {
    const decoded = verifyToken(
      socket.handshake.auth.token,
      process.env.JWT_SECRET
    );
    if (!decoded) return socket.disconnect(true);

    socket.on("subscribe_booking", (bookingId) => {
      if (!bookingId) return;
      socket.join(`booking:${bookingId}`);
    });

    socket.on("unsubscribe_booking", (bookingId) => {
      socket.leave(`booking:${bookingId}`);
    });
  });

  return io;
}

module.exports = { attachLocationServer };