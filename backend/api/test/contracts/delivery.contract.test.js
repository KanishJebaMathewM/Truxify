import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import crypto from "crypto";
import express from "express";

const { createSupabaseMock } = await vi.importActual(
  "../helpers/supabaseMock.js",
);
const m = createSupabaseMock();

let mockRedis = null;
let mockMongoDb = null;
let completeTripRpcError = null;

const originalRpc = m.supabase.rpc;
m.supabase.rpc = vi.fn().mockImplementation(async (fnName, args) => {
  if (fnName === "complete_trip_tx") {
    m.calls.push({ rpc: fnName, args });
    if (completeTripRpcError) {
      const error = completeTripRpcError;
      completeTripRpcError = null;
      return { data: null, error };
    }
    const orderId = args.p_order_id;
    const otp = m.store.delivery_otps.find(
      (record) =>
        record.id === args.p_otp_id &&
        record.order_id === orderId &&
        record.verified === false &&
        new Date(record.expires_at) >= new Date(),
    );
    if (!otp) {
      return {
        data: null,
        error: {
          message: "Delivery OTP is invalid, expired, or already verified",
        },
      };
    }
    const order = m.store.orders.find((o) => o.id === orderId);
    if (order) {
      otp.verified = true;
      otp.verified_at = new Date().toISOString();
      order.status = "payment_released";
      order.updated_at = new Date().toISOString();
      const timeline = m.store.order_timeline.find(
        (t) =>
          t.order_display_id === order.order_display_id &&
          t.milestone === "Delivered",
      );
      if (timeline) {
        timeline.completed = true;
        timeline.milestone_time = new Date().toISOString();
      }
    }
    return { data: null, error: null };
  }
  return originalRpc(fnName, args);
});

vi.mock("../../src/config/db.js", () => ({
  supabase: m.supabase,
  supabaseAdmin: m.supabase,
  createUserClient: () => m.supabase,
  firebaseAdmin: null,
  get redisClient() {
    return mockRedis;
  },
  get mongoDb() {
    return mockMongoDb;
  },
}));

vi.mock("../../src/sockets/tracker.js", () => ({
  initWebSocketServer: () => ({}),
}));

const escrowReleaseMock = vi.fn();
vi.mock("../../src/services/escrow.js", async () => {
  const actual = await vi.importActual("../../src/services/escrow.js");
  return {
    ...actual,
    escrowRelease: escrowReleaseMock,
  };
});

const { default: orderRouter } =
  await import("../../src/routes/orderRoutes.js");
import {
  expectContract,
  expectErrorContract,
  expectValidationError,
  expectServerError,
  expectForbidden,
  expectNotFound,
} from "./helpers/responseMatchers.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/orders", orderRouter);
  return app;
}

const DRIVER = {
  "x-user-id": "driver-123",
  "x-user-role": "driver",
};

const CUSTOMER = {
  "x-user-id": "customer-456",
  "x-user-role": "customer",
};

const DROP_LAT = 28.6139;
const DROP_LNG = 77.209;

function makeMongoDbMock(records) {
  return {
    collection: () => ({
      find: () => ({
        sort: () => ({
          limit: () => ({
            toArray: async () => records,
          }),
        }),
      }),
    }),
  };
}

function seedDriverAtDropOff(
  orderId,
  driverId,
  lat = DROP_LAT,
  lng = DROP_LNG,
) {
  mockMongoDb = makeMongoDbMock([
    {
      driver_id: driverId,
      order_id: orderId,
      lat,
      lng,
      server_received_at: new Date(),
    },
  ]);
}

function makeOtpRecord(id, orderId) {
  return {
    id,
    order_id: orderId,
    otp_hash: crypto.createHash("sha256").update("123456").digest("hex"),
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    verified: false,
    created_at: new Date().toISOString(),
  };
}

// Minimal in-memory Redis mock covering the surface the verify-delivery flow
// touches: idempotency caching, the escrow lock (SET ... PX/NX) and the Lua
// release. Without it acquireLock() returns null and verifyDeliveryFn aborts
// with 409 before the handler runs.
function makeRedisMock() {
  const store = new Map();
  return {
    async get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(key, value, ...args) {
      const entry = { value };
      if (args.includes("EX")) {
        entry.expiresAt =
          Date.now() + Number(args[args.indexOf("EX") + 1]) * 1000;
      } else if (args.includes("PX")) {
        entry.expiresAt = Date.now() + Number(args[args.indexOf("PX") + 1]);
      } else {
        entry.expiresAt = Infinity;
      }
      if (args.includes("NX") && store.has(key)) {
        return null;
      }
      store.set(key, entry);
      return "OK";
    },
    async del(key) {
      return store.delete(key) ? 1 : 0;
    },
    async eval(script, numkeys, ...args) {
      const key = args[0];
      const value = args[1];
      if (script.includes("DEL") || script.includes("del")) {
        if (store.get(key)?.value === value) {
          store.delete(key);
          return 1;
        }
        return 0;
      }
      return 0;
    },
  };
}

describe("POST /api/orders/:id/verify-delivery — delivery verification contract", () => {
  beforeEach(() => {
    m.store.orders = [];
    m.store.order_timeline = [];
    m.store.delivery_otps = [];
    m.calls.length = 0;
    completeTripRpcError = null;
    escrowReleaseMock.mockReset();
    mockRedis = makeRedisMock();
    mockMongoDb = makeMongoDbMock([]);
  });

  it("200: returns success message on valid delivery verification", async () => {
    m.store.orders.push({
      id: "order-dv-1",
      driver_id: DRIVER["x-user-id"],
      order_display_id: "ORD-DV",
      status: "arriving",
      drop_lat: DROP_LAT,
      drop_lng: DROP_LNG,
    });
    m.store.delivery_otps.push(makeOtpRecord("otp-dv-1", "order-dv-1"));
    seedDriverAtDropOff("order-dv-1", DRIVER["x-user-id"]);
    m.store.order_timeline.push({
      order_display_id: "ORD-DV",
      milestone: "Delivered",
      completed: false,
    });

    const res = await request(buildApp())
      .post("/api/orders/order-dv-1/verify-delivery")
      .set("X-Idempotency-Key", "dv-test-1")
      .set(DRIVER)
      .send({ otp: "123456" });

    expectContract(res, 200);
    expect(res.body).toHaveProperty("message");
    expect(typeof res.body.message).toBe("string");
    expect(res.body.message).toMatch(/Delivery confirmed/i);
  });

  it("200: releases funded escrow and completes the trip", async () => {
    escrowReleaseMock.mockResolvedValue({ txHash: "0xrelease" });

    m.store.orders.push({
      id: "order-dv-2",
      driver_id: DRIVER["x-user-id"],
      order_display_id: "ORD-DV-202",
      status: "arriving",
      total_amount: 125000,
      escrow_status: "funded",
      drop_lat: DROP_LAT,
      drop_lng: DROP_LNG,
    });
    m.store.delivery_otps.push(makeOtpRecord("otp-dv-2", "order-dv-2"));
    seedDriverAtDropOff("order-dv-2", DRIVER["x-user-id"]);
    m.store.order_timeline.push({
      order_display_id: "ORD-DV-202",
      milestone: "Delivered",
      completed: false,
    });

    const res = await request(buildApp())
      .post("/api/orders/order-dv-2/verify-delivery")
      .set("X-Idempotency-Key", "dv-test-2")
      .set(DRIVER)
      .send({ otp: "123456" });

    expectContract(res, 200);
    expect(escrowReleaseMock).toHaveBeenCalledWith("ORD-DV-202");
    expect(m.calls.find((c) => c.rpc === "complete_trip_tx")).toBeTruthy();
  });

  it("200: confirm-otp returns numeric amount_inr and non-null order_display_id", async () => {
    escrowReleaseMock.mockResolvedValue({ txHash: "0xrelease" });

    m.store.orders.push({
      id: "order-cotp-1",
      driver_id: DRIVER["x-user-id"],
      order_display_id: "ORD-COTP",
      status: "arriving",
      total_amount: 500000,
      escrow_status: "funded",
      drop_lat: DROP_LAT,
      drop_lng: DROP_LNG,
    });
    m.store.delivery_otps.push(makeOtpRecord("otp-cotp-1", "order-cotp-1"));
    seedDriverAtDropOff("order-cotp-1", DRIVER["x-user-id"]);
    m.store.order_timeline.push({
      order_display_id: "ORD-COTP",
      milestone: "Delivered",
      completed: false,
    });

    const res = await request(buildApp())
      .post("/api/orders/order-cotp-1/confirm-otp")
      .set("X-Idempotency-Key", "cotp-test-1")
      .set(DRIVER)
      .send({ otp: "123456" });

    expectContract(res, 200);
    expect(res.body.payment_released).toBe(true);
    expect(typeof res.body.amount_inr).toBe("string");
    expect(Number.isNaN(Number(res.body.amount_inr))).toBe(false);
    expect(res.body.amount_inr).toBe("5000");
    expect(res.body.order_display_id).toBe("ORD-COTP");
  });

  it("400: validation error when OTP missing", async () => {
    const res = await request(buildApp())
      .post("/api/orders/order-dv-1/verify-delivery")
      .set("X-Idempotency-Key", "dv-test-3")
      .set(DRIVER)
      .send({});

    expectValidationError(res);
    const fields = res.body.details.map((d) => d.field);
    expect(fields).toContain("otp");
  });

  it("400: invalid OTP returns descriptive error", async () => {
    m.store.orders.push({
      id: "order-dv-3",
      driver_id: DRIVER["x-user-id"],
      order_display_id: "ORD-INV-OTP",
      status: "arriving",
    });
    m.store.delivery_otps.push({
      id: "otp-dv-3",
      order_id: "order-dv-3",
      otp_hash: crypto.createHash("sha256").update("123456").digest("hex"),
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      verified: false,
      created_at: new Date().toISOString(),
    });

    const res = await request(buildApp())
      .post("/api/orders/order-dv-3/verify-delivery")
      .set("X-Idempotency-Key", "dv-test-4")
      .set(DRIVER)
      .send({ otp: "654321" });

    expectErrorContract(res, 400);
    expect(res.body.error).toContain("Invalid OTP");
  });

  it("403: forbidden when driver not assigned", async () => {
    m.store.orders.push({
      id: "order-dv-4",
      driver_id: "driver-different",
      order_display_id: "ORD-NOT-ASSIGNED",
      status: "arriving",
    });

    const res = await request(buildApp())
      .post("/api/orders/order-dv-4/verify-delivery")
      .set("X-Idempotency-Key", "dv-test-5")
      .set(DRIVER)
      .send({ otp: "123456" });

    expectForbidden(res);
  });

  it("503: service unavailable when escrow release fails", async () => {
    escrowReleaseMock.mockRejectedValue(new Error("Polygon RPC unavailable"));

    m.store.orders.push({
      id: "order-dv-5",
      driver_id: DRIVER["x-user-id"],
      order_display_id: "ORD-ESCROW-FAIL",
      status: "arriving",
      total_amount: 125000,
      escrow_status: "funded",
      drop_lat: DROP_LAT,
      drop_lng: DROP_LNG,
    });
    m.store.delivery_otps.push(makeOtpRecord("otp-dv-5", "order-dv-5"));
    seedDriverAtDropOff("order-dv-5", DRIVER["x-user-id"]);

    const res = await request(buildApp())
      .post("/api/orders/order-dv-5/verify-delivery")
      .set("X-Idempotency-Key", "dv-test-6")
      .set(DRIVER)
      .send({ otp: "123456" });

    expectErrorContract(res, 503);
    expect(res.body).toHaveProperty("retryable");
    expect(res.body.retryable).toBe(true);
  });

  it("500: server error when complete_trip_tx RPC fails", async () => {
    m.store.orders.push({
      id: "order-dv-6",
      driver_id: DRIVER["x-user-id"],
      order_display_id: "ORD-RPC-FAIL",
      status: "arriving",
      drop_lat: DROP_LAT,
      drop_lng: DROP_LNG,
    });
    m.store.delivery_otps.push(makeOtpRecord("otp-dv-6", "order-dv-6"));
    seedDriverAtDropOff("order-dv-6", DRIVER["x-user-id"]);

    completeTripRpcError = { message: "Database temporary failure" };

    const res = await request(buildApp())
      .post("/api/orders/order-dv-6/verify-delivery")
      .set("X-Idempotency-Key", "dv-test-7")
      .set(DRIVER)
      .send({ otp: "123456" });

    expectServerError(res);
  });

  it("409: rejects escrow release when the driver is outside the geofence", async () => {
    escrowReleaseMock.mockResolvedValue({ txHash: "0xrelease" });

    m.store.orders.push({
      id: "order-dv-7",
      driver_id: DRIVER["x-user-id"],
      order_display_id: "ORD-OUTSIDE-GEOFENCE",
      status: "arriving",
      total_amount: 125000,
      escrow_status: "funded",
      drop_lat: DROP_LAT,
      drop_lng: DROP_LNG,
    });
    m.store.delivery_otps.push(makeOtpRecord("otp-dv-7", "order-dv-7"));
    seedDriverAtDropOff("order-dv-7", DRIVER["x-user-id"], DROP_LAT, 77.218);

    const res = await request(buildApp())
      .post("/api/orders/order-dv-7/verify-delivery")
      .set("X-Idempotency-Key", "dv-test-8")
      .set(DRIVER)
      .send({ otp: "123456" });

    expectErrorContract(res, 409);
    expect(res.body.error).toMatch(/km from the drop-off/i);
    expect(escrowReleaseMock).not.toHaveBeenCalled();
    expect(m.calls.find((c) => c.rpc === "complete_trip_tx")).toBeFalsy();
  });

  it("409: rejects when no driver telemetry exists for the order", async () => {
    escrowReleaseMock.mockResolvedValue({ txHash: "0xrelease" });

    m.store.orders.push({
      id: "order-dv-8",
      driver_id: DRIVER["x-user-id"],
      order_display_id: "ORD-NO-TELEMETRY",
      status: "arriving",
      total_amount: 125000,
      escrow_status: "funded",
      drop_lat: DROP_LAT,
      drop_lng: DROP_LNG,
    });
    m.store.delivery_otps.push(makeOtpRecord("otp-dv-8", "order-dv-8"));

    const res = await request(buildApp())
      .post("/api/orders/order-dv-8/verify-delivery")
      .set("X-Idempotency-Key", "dv-test-9")
      .set(DRIVER)
      .send({ otp: "123456" });

    expectErrorContract(res, 409);
    expect(res.body.error).toMatch(/location is not available/i);
    expect(escrowReleaseMock).not.toHaveBeenCalled();
    expect(m.calls.find((c) => c.rpc === "complete_trip_tx")).toBeFalsy();
  });

  it("503: rejects when the driver location service is unavailable", async () => {
    escrowReleaseMock.mockResolvedValue({ txHash: "0xrelease" });
    mockMongoDb = null;

    m.store.orders.push({
      id: "order-dv-9",
      driver_id: DRIVER["x-user-id"],
      order_display_id: "ORD-LOC-DOWN",
      status: "arriving",
      total_amount: 125000,
      escrow_status: "funded",
      drop_lat: DROP_LAT,
      drop_lng: DROP_LNG,
    });
    m.store.delivery_otps.push(makeOtpRecord("otp-dv-9", "order-dv-9"));

    const res = await request(buildApp())
      .post("/api/orders/order-dv-9/verify-delivery")
      .set("X-Idempotency-Key", "dv-test-10")
      .set(DRIVER)
      .send({ otp: "123456" });

    expectErrorContract(res, 503);
    expect(res.body.retryable).toBe(true);
    expect(escrowReleaseMock).not.toHaveBeenCalled();
    expect(m.calls.find((c) => c.rpc === "complete_trip_tx")).toBeFalsy();
  });
});

describe("POST /api/orders/:id/resend-otp — resend OTP contract", () => {
  beforeEach(() => {
    m.store.orders = [];
    m.store.delivery_otps = [];
    m.calls.length = 0;
  });

  it("200: returns message and expiresInMinutes", async () => {
    m.store.orders.push({
      id: "order-rotp-1",
      driver_id: DRIVER["x-user-id"],
      customer_id: CUSTOMER["x-user-id"],
      order_display_id: "ORD-ROTP",
      status: "arriving",
    });

    const res = await request(buildApp())
      .post("/api/orders/order-rotp-1/resend-otp")
      .set(DRIVER);

    expectContract(res, 200);
    expect(res.body).toHaveProperty("message");
    expect(typeof res.body.message).toBe("string");
    expect(res.body).toHaveProperty("expiresInMinutes");
    expect(typeof res.body.expiresInMinutes).toBe("number");
  });

  it("403: forbidden when driver not assigned", async () => {
    m.store.orders.push({
      id: "order-rotp-2",
      driver_id: "driver-different",
      customer_id: CUSTOMER["x-user-id"],
      order_display_id: "ORD-OTHER-DRIVER",
      status: "arriving",
    });

    const res = await request(buildApp())
      .post("/api/orders/order-rotp-2/resend-otp")
      .set(DRIVER);

    expectForbidden(res);
  });

  it("404: not found for non-existent order", async () => {
    const res = await request(buildApp())
      .post("/api/orders/nonexistent/resend-otp")
      .set(DRIVER);

    expectNotFound(res);
  });
});
