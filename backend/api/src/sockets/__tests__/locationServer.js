import { createServer } from "http";
import { io as Client } from "socket.io-client";
import { attachLocationServer } from "../locationServer.js";
import express from "express";

// Set bypass auth for tests
process.env.BYPASS_AUTH = "true";
process.env.NODE_ENV = "test";

describe("WebSocket Location Server", () => {
  let httpServer, serverAddress;
  let driverSocket, customerSocket;

  beforeAll((done) => {
    const app = express();
    httpServer = createServer(app);
    attachLocationServer(httpServer);
    httpServer.listen(0, () => {
      serverAddress = `http://localhost:${httpServer.address().port}`;
      done();
    });
  });

  afterAll(() => {
    httpServer.close();
  });

  afterEach(() => {
    driverSocket?.disconnect();
    customerSocket?.disconnect();
  });

  test("driver can connect to /driver namespace with valid auth", (done) => {
    driverSocket = Client(`${serverAddress}/driver`, {
      auth: { token: "bypass", driverId: "driver-1", bookingId: "booking-1" },
    });
    driverSocket.on("connect", () => {
      expect(driverSocket.connected).toBe(true);
      done();
    });
  });

  test("customer receives location_update after driver emits", (done) => {
    const bookingId = "booking-test-123";

    // Connect customer first
    customerSocket = Client(`${serverAddress}/customer`, {
      auth: { token: "bypass", customerId: "customer-1" },
    });

    customerSocket.on("connect", () => {
      customerSocket.emit("subscribe_booking", { bookingId });

      customerSocket.on("subscribed", () => {
        // Now connect driver and emit location
        driverSocket = Client(`${serverAddress}/driver`, {
          auth: { token: "bypass", driverId: "driver-1", bookingId },
        });

        driverSocket.on("connect", () => {
          driverSocket.emit("location_update", {
            bookingId,
            lat: 28.6139,
            lng: 77.2090,
            speed: 65,
            heading: 180,
            timestamp: new Date().toISOString(),
          });
        });
      });

      customerSocket.on("driver_location", (data) => {
        expect(data.lat).toBe(28.6139);
        expect(data.lng).toBe(77.2090);
        expect(data.speed).toBe(65);
        expect(data.bookingId).toBe(bookingId);
        done();
      });
    });
  });

  test("invalid GPS coordinates are rejected", (done) => {
    driverSocket = Client(`${serverAddress}/driver`, {
      auth: { token: "bypass", driverId: "driver-1", bookingId: "booking-x" },
    });

    driverSocket.on("connect", () => {
      driverSocket.emit("location_update", {
        bookingId: "booking-x",
        lat: 999,   // Invalid
        lng: 77.2090,
        timestamp: new Date().toISOString(),
      });
    });

    driverSocket.on("error", (err) => {
      expect(err.message).toContain("Invalid GPS coordinates");
      done();
    });
  });
});