/**
 * Unit tests for the delivery geofence check (issue #5624).
 *
 * Locks in the contract invariant that escrow is only released after the
 * driver's latest telemetry point is confirmed to be within the geofence
 * radius of the order's drop-off location, and that the check is skipped on
 * the stuck-escrow retry path.
 *
 * Run with:  npx vitest run test/unit/deliveryVerificationGeofence.test.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DeliveryVerificationService } from "../../src/services/order/deliveryVerificationService.js";
import { DomainError } from "../../src/services/order/domainError.js";
import crypto from "crypto";

const h = vi.hoisted(() => ({
  mockMongoDb: null,
}));

let mockTelemetryRecords = [];

vi.mock("../../src/config/db.js", () => ({
  supabase: { from: vi.fn() },
  supabaseAdmin: null,
  firebaseAdmin: null,
  redisClient: null,
  get mongoDb() {
    return h.mockMongoDb;
  },
}));

vi.mock("../../src/middleware/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/services/notificationService.js", () => ({
  sendDeliveryOtpNotification: vi.fn(),
  storeDeliveryOtp: vi.fn(),
  getActiveDeliveryOtp: vi.fn(),
  verifyDeliveryOtp: vi.fn(),
  verifyDeliveryOtpHash: vi.fn(),
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));

const DROP_LAT = 28.6139;
const DROP_LNG = 77.209;
const OTP_HASH = crypto.createHash("sha256").update("123456").digest("hex");

function makeMongoMock() {
  return {
    collection: () => ({
      find: () => ({
        sort: () => ({
          limit: () => ({
            toArray: async () => mockTelemetryRecords,
          }),
        }),
      }),
    }),
  };
}

function makeOrder(overrides = {}) {
  return {
    id: "order-geo-1",
    order_display_id: "ORD-GEO",
    driver_id: "driver-1",
    customer_id: "customer-1",
    status: "arriving",
    escrow_status: "funded",
    escrow_release_attempts: 0,
    drop_lat: DROP_LAT,
    drop_lng: DROP_LNG,
    ...overrides,
  };
}

function makeTelemetry(lat, lng, ageMs = 1000, overrides = {}) {
  return {
    driver_id: "driver-1",
    order_id: "order-geo-1",
    lat,
    lng,
    server_received_at: new Date(Date.now() - ageMs),
    ...overrides,
  };
}

function makeOtpRecord() {
  return {
    id: "otp-geo-1",
    order_id: "order-geo-1",
    otp_hash: OTP_HASH,
    verified: false,
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
}

function makeService({ repoOverrides = {}, escrowReleaseFn } = {}) {
  const repo = {
    findOrderById: vi
      .fn()
      .mockResolvedValueOnce({ data: makeOrder(), error: null })
      .mockResolvedValueOnce({
        data: {
          status: "payment_released",
          escrow_status: "released",
          escrow_release_attempts: 0,
        },
        error: null,
      }),
    updateOrderGuardStatus: vi
      .fn()
      .mockResolvedValue({ data: null, error: null }),
    executeRpc: vi
      .fn()
      .mockResolvedValue({
        data: { driver_id: "driver-1", order_display_id: "ORD-GEO" },
        error: null,
      }),
    updateOrder: vi.fn().mockResolvedValue({ data: null, error: null }),
    updateWalletTransaction: vi
      .fn()
      .mockResolvedValue({ data: null, error: null }),
    ...repoOverrides,
  };
  const notificationService = {
    getActiveDeliveryOtp: vi.fn().mockResolvedValue(makeOtpRecord()),
    verifyDeliveryOtp: vi.fn().mockResolvedValue(true),
    verifyDeliveryOtpHash: vi.fn().mockReturnValue(true),
  };
  const service = new DeliveryVerificationService(repo, {
    notificationService,
    orderTimelineService: {},
    escrowReleaseFn:
      escrowReleaseFn || vi.fn().mockResolvedValue({ txHash: "0xrelease" }),
  });
  return { service, repo, notificationService };
}

function captureDomainError(promise) {
  return promise.then(
    () => null,
    (err) => err,
  );
}

beforeEach(() => {
  mockTelemetryRecords = [];
  h.mockMongoDb = makeMongoMock();
});

afterEach(() => {
  h.mockMongoDb = null;
  mockTelemetryRecords = [];
  vi.clearAllMocks();
});

describe("DeliveryVerificationService.assertDriverAtDropoff", () => {
  it("rejects when the order is missing drop-off coordinates", async () => {
    const { service } = makeService();
    const err = await captureDomainError(
      service.assertDriverAtDropoff(
        makeOrder({ drop_lat: null, drop_lng: null }),
      ),
    );
    expect(err).toBeInstanceOf(DomainError);
    expect(err.status).toBe(400);
    expect(err.payload.error).toMatch(/missing drop-off coordinates/i);
  });

  it("rejects with 503 when the location store is unavailable", async () => {
    h.mockMongoDb = null;
    const { service } = makeService();
    const err = await captureDomainError(
      service.assertDriverAtDropoff(makeOrder()),
    );
    expect(err).toBeInstanceOf(DomainError);
    expect(err.status).toBe(503);
    expect(err.payload.retryable).toBe(true);
  });

  it("rejects when no telemetry exists for the driver on this order", async () => {
    const { service } = makeService();
    const err = await captureDomainError(
      service.assertDriverAtDropoff(makeOrder()),
    );
    expect(err).toBeInstanceOf(DomainError);
    expect(err.status).toBe(409);
    expect(err.payload.error).toMatch(/location is not available/i);
  });

  it("rejects when telemetry coordinates are invalid", async () => {
    mockTelemetryRecords = [makeTelemetry("NaN", DROP_LNG)];
    const { service } = makeService();
    const err = await captureDomainError(
      service.assertDriverAtDropoff(makeOrder()),
    );
    expect(err).toBeInstanceOf(DomainError);
    expect(err.status).toBe(409);
    expect(err.payload.error).toMatch(/location is invalid/i);
  });

  it("rejects when the latest telemetry is stale", async () => {
    mockTelemetryRecords = [makeTelemetry(DROP_LAT, DROP_LNG, 6 * 60 * 1000)];
    const { service } = makeService();
    const err = await captureDomainError(
      service.assertDriverAtDropoff(makeOrder()),
    );
    expect(err).toBeInstanceOf(DomainError);
    expect(err.status).toBe(409);
    expect(err.payload.error).toMatch(/stale/i);
  });

  it("rejects when the driver is outside the geofence radius", async () => {
    mockTelemetryRecords = [makeTelemetry(28.6139, 77.218)];
    const { service } = makeService();
    const err = await captureDomainError(
      service.assertDriverAtDropoff(makeOrder()),
    );
    expect(err).toBeInstanceOf(DomainError);
    expect(err.status).toBe(409);
    expect(err.payload.error).toMatch(/km from the drop-off/i);
  });

  it("passes when the driver is exactly at the drop-off location", async () => {
    mockTelemetryRecords = [makeTelemetry(DROP_LAT, DROP_LNG)];
    const { service } = makeService();
    await expect(
      service.assertDriverAtDropoff(makeOrder()),
    ).resolves.toBeUndefined();
  });

  it("passes when the driver is just inside the geofence radius", async () => {
    mockTelemetryRecords = [makeTelemetry(28.6139, 77.2135)];
    const { service } = makeService();
    await expect(
      service.assertDriverAtDropoff(makeOrder()),
    ).resolves.toBeUndefined();
  });
});

describe("DeliveryVerificationService.geofenceAutoConfirm radius override", () => {
  // 0.004 deg lng at this latitude ≈ 390m east of the drop; inside the env
  // default (500m) but outside a 200m override.
  it("rejects a driver just outside a small per-request radius override", async () => {
    mockTelemetryRecords = [makeTelemetry(28.6139, 77.213)];
    const { service } = makeService();
    const err = await captureDomainError(
      service.geofenceAutoConfirm({
        orderId: "order-geo-1",
        driverId: "driver-1",
        driverLat: 28.6139,
        driverLng: 77.213,
        geofenceRadiusM: 200,
      }),
    );
    expect(err).toBeInstanceOf(DomainError);
    expect(err.status).toBe(409);
    expect(err.payload.error).toMatch(/must be within 200m/i);
  });

  it("passes the same position when no override is given (env default applies)", async () => {
    mockTelemetryRecords = [makeTelemetry(28.6139, 77.213)];
    const { service, repo } = makeService();
    const result = await service.geofenceAutoConfirm({
      orderId: "order-geo-1",
      driverId: "driver-1",
      driverLat: 28.6139,
      driverLng: 77.213,
    });
    expect(result.autoConfirmed).toBe(true);
    expect(repo.updateOrder).toHaveBeenCalledWith(
      "order-geo-1",
      expect.objectContaining({ updated_at: expect.any(String) }),
    );
  });

  // 0.007 deg lng at this latitude ≈ 685m east of the drop; outside the env
  // default (500m) but inside a 1000m override.
  it("rejects a driver outside the env radius even when a larger override is provided (clamped to env default)", async () => {
    mockTelemetryRecords = [makeTelemetry(28.6139, 77.216)];
    const { service } = makeService();
    const err = await captureDomainError(
      service.geofenceAutoConfirm({
        orderId: "order-geo-1",
        driverId: "driver-1",
        driverLat: 28.6139,
        driverLng: 77.216,
        geofenceRadiusM: 1000,
      })
    );
    expect(err).toBeInstanceOf(DomainError);
    expect(err.status).toBe(409);
  });

  it("rejects the same driver without the larger override", async () => {
    mockTelemetryRecords = [makeTelemetry(28.6139, 77.216)];
    const { service } = makeService();
    const err = await captureDomainError(
      service.geofenceAutoConfirm({
        orderId: "order-geo-1",
        driverId: "driver-1",
        driverLat: 28.6139,
        driverLng: 77.216,
      }),
    );
    expect(err).toBeInstanceOf(DomainError);
    expect(err.status).toBe(409);
  });
});

describe("DeliveryVerificationService.verifyDelivery geofence gating", () => {
  it("releases escrow only after the geofence check passes", async () => {
    mockTelemetryRecords = [makeTelemetry(DROP_LAT, DROP_LNG)];
    const escrowReleaseFn = vi.fn().mockResolvedValue({ txHash: "0xrelease" });
    const { service, repo } = makeService({
      escrowReleaseFn,
      repoOverrides: {
        findOrderById: vi
          .fn()
          .mockResolvedValueOnce({
            data: makeOrder({
              total_amount: 375000,
              escrow_amount_wei: 1500000000000000000n.toString(),
            }),
            error: null,
          })
          .mockResolvedValueOnce({
            data: {
              status: "payment_released",
              escrow_status: "released",
              escrow_release_attempts: 0,
            },
            error: null,
          }),
      },
    });
    const result = await service.verifyDelivery({
      orderId: "order-geo-1",
      driverId: "driver-1",
      otp: "123456",
    });
    expect(escrowReleaseFn).toHaveBeenCalledWith("ORD-GEO", 1500000000000000000n);
    expect(repo.executeRpc).toHaveBeenCalled();
    expect(result.escrowUpdateFailed).toBe(false);
  });

  it("releases escrow with expected amount when matching total_amount is available", async () => {
    mockTelemetryRecords = [makeTelemetry(DROP_LAT, DROP_LNG)];
    const escrowReleaseFn = vi.fn().mockResolvedValue({ txHash: "0xrelease" });
    const { service, repo } = makeService({
      escrowReleaseFn,
      repoOverrides: {
        findOrderById: vi
          .fn()
          .mockResolvedValueOnce({
            data: makeOrder({
              total_amount: 375000,
              escrow_amount_wei: 1500000000000000000n.toString(), // 1.5 ETH (matic equivalent)
            }),
            error: null,
          })
          .mockResolvedValueOnce({
            data: {
              status: "payment_released",
              escrow_status: "released",
              escrow_release_attempts: 0,
            },
            error: null,
          }),
      },
    });
    const result = await service.verifyDelivery({
      orderId: "order-geo-1",
      driverId: "driver-1",
      otp: "123456",
    });
    // paisaToMaticWei(150000) -> 1.5 * 10^18 -> 1500000000000000000n
    expect(escrowReleaseFn).toHaveBeenCalledWith("ORD-GEO", 1500000000000000000n);
    expect(repo.executeRpc).toHaveBeenCalled();
    expect(result.escrowUpdateFailed).toBe(false);
  });

  it("aborts escrow release and returns 409 non-retryable when escrow amount mismatches expected total_amount", async () => {
    mockTelemetryRecords = [makeTelemetry(DROP_LAT, DROP_LNG)];
    const escrowReleaseFn = vi.fn().mockResolvedValue({ txHash: "0xrelease" });
    const { service, repo } = makeService({
      escrowReleaseFn,
      repoOverrides: {
        findOrderById: vi
          .fn()
          .mockResolvedValueOnce({
            data: makeOrder({
              total_amount: 400000, // != 1.5 Matic
              escrow_amount_wei: 1500000000000000000n.toString(), // 1.5 Matic
            }),
            error: null,
          })
          .mockResolvedValueOnce({
            data: {
              status: "payment_released",
              escrow_status: "released",
              escrow_release_attempts: 0,
            },
            error: null,
          }),
      },
    });
    const err = await captureDomainError(
      service.verifyDelivery({
        orderId: "order-geo-1",
        driverId: "driver-1",
        otp: "123456",
      })
    );
    expect(err).toBeInstanceOf(DomainError);
    expect(err.status).toBe(409);
    expect(err.payload.retryable).toBe(false);
    expect(err.payload.code).toBe("ESCROW_AMOUNT_MISMATCH");
    expect(escrowReleaseFn).not.toHaveBeenCalled();
    expect(repo.updateOrder).toHaveBeenCalledWith(
      "order-geo-1",
      expect.objectContaining({ escrow_status: "release_failed" })
    );
  });

  it("aborts before escrow release when the driver is outside the geofence", async () => {
    mockTelemetryRecords = [makeTelemetry(28.6139, 77.218)];
    const escrowReleaseFn = vi.fn().mockResolvedValue({ txHash: "0xrelease" });
    const { service, repo } = makeService({ escrowReleaseFn });
    const err = await captureDomainError(
      service.verifyDelivery({
        orderId: "order-geo-1",
        driverId: "driver-1",
        otp: "123456",
      }),
    );
    expect(err).toBeInstanceOf(DomainError);
    expect(err.status).toBe(409);
    expect(escrowReleaseFn).not.toHaveBeenCalled();
    expect(repo.executeRpc).not.toHaveBeenCalled();
  });

  it("skips the geofence check on the stuck-escrow retry path", async () => {
    h.mockMongoDb = null;
    const escrowReleaseFn = vi.fn().mockResolvedValue({ txHash: "0xrelease" });
    const { service, repo } = makeService({
      escrowReleaseFn,
      repoOverrides: {
        findOrderById: vi
          .fn()
          .mockResolvedValueOnce({
            data: makeOrder({
              status: "payment_released",
              escrow_status: "funded",
              total_amount: 375000,
              escrow_amount_wei: 1500000000000000000n.toString(),
            }),
            error: null,
          })
          .mockResolvedValueOnce({
            data: {
              status: "payment_released",
              escrow_status: "released",
              escrow_release_attempts: 0,
            },
            error: null,
          }),
      },
    });
    const result = await service.verifyDelivery({
      orderId: "order-geo-1",
      driverId: "driver-1",
      otp: "123456",
    });
    expect(escrowReleaseFn).toHaveBeenCalledWith("ORD-GEO", 1500000000000000000n);
    expect(repo.executeRpc).not.toHaveBeenCalled();
    expect(repo.updateOrder).toHaveBeenCalled();
    expect(result.escrowUpdateFailed).toBe(false);
  });
  it("aborts escrow release and returns 409 non-retryable when no escrow amount is available", async () => {
    mockTelemetryRecords = [makeTelemetry(DROP_LAT, DROP_LNG)];
    const escrowReleaseFn = vi.fn().mockResolvedValue({ txHash: "0xrelease" });
    const { service, repo } = makeService({ escrowReleaseFn });
    const err = await captureDomainError(
      service.verifyDelivery({
        orderId: "order-geo-1",
        driverId: "driver-1",
        otp: "123456",
      })
    );
    expect(err).toBeInstanceOf(DomainError);
    expect(err.status).toBe(409);
    expect(err.payload.retryable).toBe(false);
    expect(err.payload.code).toBe("ESCROW_AMOUNT_MISSING");
    expect(escrowReleaseFn).not.toHaveBeenCalled();
    expect(repo.updateOrder).toHaveBeenCalledWith(
      "order-geo-1",
      expect.objectContaining({ escrow_status: "release_failed" })
    );
  });
});
