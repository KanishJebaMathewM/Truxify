import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  supabase: { from: vi.fn() },
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  verifyDeliveryOtpHash: vi.fn(),
  assertDriverAtDropoff: vi.fn(),
}));

vi.mock("../../src/config/db.js", () => ({
  supabase: mocks.supabase,
}));

vi.mock("../../src/middleware/logger.js", () => ({
  default: mocks.logger,
}));

vi.mock("../../src/services/notificationService.js", () => ({
  verifyDeliveryOtpHash: mocks.verifyDeliveryOtpHash,
}));

vi.mock("../../src/services/order/deliveryVerificationService.js", () => ({
  DeliveryVerificationService: class MockDeliveryVerificationService {
    assertDriverAtDropoff(...args) {
      return mocks.assertDriverAtDropoff(...args);
    }
  },
}));

import OracleService, {
  ORACLE_PROVIDER_COUNT,
  ORACLE_THRESHOLD,
} from "../../src/oracle/OracleService.js";

const orderId = "order-oracle-1";
const validCoordinates = { lat: 28.6139, lng: 77.209 };

function queryBuilder(result) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  return builder;
}

function configureQueries(...results) {
  const builders = results.map((result) => queryBuilder(result));
  mocks.supabase.from.mockImplementationOnce(() => builders[0]);
  builders.slice(1).forEach((builder) => {
    mocks.supabase.from.mockImplementationOnce(() => builder);
  });
  return builders;
}

function makeService() {
  return new OracleService({ supabase: mocks.supabase });
}

function makeOrder(overrides = {}) {
  return {
    id: orderId,
    driver_id: "driver-1",
    drop_lat: validCoordinates.lat,
    drop_lng: validCoordinates.lng,
    status: "arriving",
    ...overrides,
  };
}

function makeOtpRecord(overrides = {}) {
  return {
    id: "otp-1",
    otp_hash: "hashed-otp",
    otp_salt: "salt-1",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    verified: false,
    ...overrides,
  };
}

function expectProviderResult(result, provider, confirmed) {
  expect(result).toMatchObject({
    provider,
    confirmed,
  });
  expect(result.timestamp).toEqual(expect.any(String));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.supabase.from.mockReset();
  mocks.verifyDeliveryOtpHash.mockReturnValue(true);
  mocks.assertDriverAtDropoff.mockResolvedValue(undefined);
});

describe("OracleService constants and status", () => {
  it("exposes the three-provider, two-provider consensus policy", () => {
    expect(ORACLE_PROVIDER_COUNT).toBe(3);
    expect(ORACLE_THRESHOLD).toBe(2);
  });

  it("returns provider and threshold status with an ISO timestamp", () => {
    const status = makeService().getStatus();

    expect(status).toMatchObject({ providers: 3, threshold: 2 });
    expect(status.timestamp).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(status.timestamp))).toBe(false);
  });
});

describe("OracleService.confirmDelivery", () => {
  it("confirms delivery when at least two providers agree", async () => {
    const service = makeService();
    vi.spyOn(service, "_verifyOTP").mockResolvedValue({
      confirmed: true,
      provider: "OTPVerifier",
    });
    vi.spyOn(service, "_verifyGPS").mockResolvedValue({
      confirmed: true,
      provider: "GPSVerifier",
    });
    vi.spyOn(service, "_verifyOrderStatus").mockResolvedValue({
      confirmed: false,
      provider: "StatusVerifier",
    });
    const logSpy = vi.spyOn(service, "logOracleResult");

    const result = await service.confirmDelivery({
      orderId,
      otp: "123456",
      gpsCoordinates: validCoordinates,
    });

    expect(result.confirmed).toBe(true);
    expect(result.consensusCount).toBe(2);
    expect(result.threshold).toBe(2);
    expect(result.totalProviders).toBe(3);
    expect(result.providerResults).toHaveLength(3);
    expect(result.timestamp).toEqual(expect.any(String));
    expect(logSpy).toHaveBeenCalledWith(orderId, result.providerResults, true);
  });

  it("confirms delivery when all three providers agree", async () => {
    const service = makeService();
    vi.spyOn(service, "_verifyOTP").mockResolvedValue({
      confirmed: true,
      provider: "OTPVerifier",
    });
    vi.spyOn(service, "_verifyGPS").mockResolvedValue({
      confirmed: true,
      provider: "GPSVerifier",
    });
    vi.spyOn(service, "_verifyOrderStatus").mockResolvedValue({
      confirmed: true,
      provider: "StatusVerifier",
    });

    const result = await service.confirmDelivery({ orderId });

    expect(result.confirmed).toBe(true);
    expect(result.consensusCount).toBe(3);
  });

  it("does not confirm delivery when fewer than two providers agree", async () => {
    const service = makeService();
    vi.spyOn(service, "_verifyOTP").mockResolvedValue({
      confirmed: false,
      provider: "OTPVerifier",
    });
    vi.spyOn(service, "_verifyGPS").mockResolvedValue({
      confirmed: true,
      provider: "GPSVerifier",
    });
    vi.spyOn(service, "_verifyOrderStatus").mockResolvedValue({
      confirmed: false,
      provider: "StatusVerifier",
    });
    const logSpy = vi.spyOn(service, "logOracleResult");

    const result = await service.confirmDelivery({ orderId });

    expect(result.confirmed).toBe(false);
    expect(result.consensusCount).toBe(1);
    expect(logSpy).toHaveBeenCalledWith(orderId, result.providerResults, false);
  });

  it("passes each verification input to the matching provider", async () => {
    const service = makeService();
    const otpSpy = vi.spyOn(service, "_verifyOTP").mockResolvedValue({
      confirmed: false,
      provider: "OTPVerifier",
    });
    const gpsSpy = vi.spyOn(service, "_verifyGPS").mockResolvedValue({
      confirmed: false,
      provider: "GPSVerifier",
    });
    const statusSpy = vi
      .spyOn(service, "_verifyOrderStatus")
      .mockResolvedValue({
        confirmed: false,
        provider: "StatusVerifier",
      });

    await service.confirmDelivery({
      orderId,
      otp: "654321",
      gpsCoordinates: validCoordinates,
    });

    expect(otpSpy).toHaveBeenCalledWith(orderId, "654321");
    expect(gpsSpy).toHaveBeenCalledWith(orderId, validCoordinates);
    expect(statusSpy).toHaveBeenCalledWith(orderId);
  });
});

describe("OracleService._verifyOTP", () => {
  it("confirms when the order is already marked otp_verified", async () => {
    configureQueries(
      { data: makeOrder({ otp_verified: true }), error: null },
      { data: makeOtpRecord(), error: null },
    );

    const result = await makeService()._verifyOTP(orderId, "123456");

    expectProviderResult(result, "OTPVerifier", true);
    expect(mocks.verifyDeliveryOtpHash).not.toHaveBeenCalled();
  });

  it("confirms when the delivery OTP record is already verified", async () => {
    configureQueries(
      { data: makeOrder(), error: null },
      { data: makeOtpRecord({ verified: true }), error: null },
    );

    const result = await makeService()._verifyOTP(orderId, "123456");

    expectProviderResult(result, "OTPVerifier", true);
  });

  it("confirms when the supplied OTP hash is valid", async () => {
    const otpRecord = makeOtpRecord();
    configureQueries(
      { data: makeOrder(), error: null },
      { data: otpRecord, error: null },
    );

    const result = await makeService()._verifyOTP(orderId, "123456");

    expectProviderResult(result, "OTPVerifier", true);
    expect(mocks.verifyDeliveryOtpHash).toHaveBeenCalledWith(
      "123456",
      otpRecord,
    );
  });

  it("returns an unconfirmed result when the supplied OTP hash is invalid", async () => {
    mocks.verifyDeliveryOtpHash.mockReturnValue(false);
    configureQueries(
      { data: makeOrder(), error: null },
      { data: makeOtpRecord(), error: null },
    );

    const result = await makeService()._verifyOTP(orderId, "000000");

    expectProviderResult(result, "OTPVerifier", false);
  });

  it("returns a not-found result when the order does not exist", async () => {
    configureQueries({ data: null, error: null });

    const result = await makeService()._verifyOTP(orderId, "123456");

    expectProviderResult(result, "OTPVerifier", false);
    expect(result.reason).toBe("Order not found");
    expect(mocks.supabase.from).toHaveBeenCalledTimes(1);
  });

  it("returns a not-found result when no OTP record exists", async () => {
    configureQueries(
      { data: makeOrder(), error: null },
      { data: null, error: null },
    );

    const result = await makeService()._verifyOTP(orderId, "123456");

    expectProviderResult(result, "OTPVerifier", false);
    expect(result.reason).toBe("No OTP record found for order");
  });

  it("returns an expired result when the OTP has expired", async () => {
    configureQueries(
      { data: makeOrder(), error: null },
      {
        data: makeOtpRecord({
          expires_at: new Date(Date.now() - 1).toISOString(),
        }),
        error: null,
      },
    );

    const result = await makeService()._verifyOTP(orderId, "123456");

    expectProviderResult(result, "OTPVerifier", false);
    expect(result.reason).toBe("OTP expired");
    expect(mocks.verifyDeliveryOtpHash).not.toHaveBeenCalled();
  });

  it("returns a database error when the order query fails", async () => {
    configureQueries({ data: null, error: { message: "orders unavailable" } });

    const result = await makeService()._verifyOTP(orderId, "123456");

    expectProviderResult(result, "OTPVerifier", false);
    expect(result.error).toBe("orders unavailable");
    expect(mocks.logger.warn).toHaveBeenCalled();
  });

  it("returns a database error when the OTP query fails", async () => {
    configureQueries(
      { data: makeOrder(), error: null },
      { data: null, error: { message: "otp table unavailable" } },
    );

    const result = await makeService()._verifyOTP(orderId, "123456");

    expectProviderResult(result, "OTPVerifier", false);
    expect(result.error).toBe("otp table unavailable");
    expect(mocks.logger.warn).toHaveBeenCalled();
  });

  it("converts unexpected OTP failures into a provider failure", async () => {
    mocks.supabase.from.mockImplementation(() => {
      throw new Error("connection dropped");
    });

    const result = await makeService()._verifyOTP(orderId, "123456");

    expectProviderResult(result, "OTPVerifier", false);
    expect(result.error).toBe("connection dropped");
    expect(mocks.logger.error).toHaveBeenCalled();
  });
});

describe("OracleService._verifyGPS", () => {
  it.each([
    ["missing coordinates", undefined],
    ["null coordinates", null],
    ["non-numeric latitude", { lat: "28.6139", lng: 77.209 }],
    ["non-numeric longitude", { lat: 28.6139, lng: "77.209" }],
    ["latitude below range", { lat: -91, lng: 77.209 }],
    ["latitude above range", { lat: 91, lng: 77.209 }],
    ["longitude below range", { lat: 28.6139, lng: -181 }],
    ["longitude above range", { lat: 28.6139, lng: 181 }],
  ])(
    "rejects %s before querying the database",
    async (_description, coordinates) => {
      const result = await makeService()._verifyGPS(orderId, coordinates);

      expectProviderResult(result, "GPSVerifier", false);
      expect(mocks.supabase.from).not.toHaveBeenCalled();
      expect(mocks.assertDriverAtDropoff).not.toHaveBeenCalled();
    },
  );

  it("confirms when the order exists and the driver is at the drop-off", async () => {
    const order = makeOrder();
    configureQueries({ data: order, error: null });

    const result = await makeService()._verifyGPS(orderId, validCoordinates);

    expectProviderResult(result, "GPSVerifier", true);
    expect(mocks.assertDriverAtDropoff).toHaveBeenCalledWith(order);
  });

  it("returns a not-found result when the order does not exist", async () => {
    configureQueries({ data: null, error: null });

    const result = await makeService()._verifyGPS(orderId, validCoordinates);

    expectProviderResult(result, "GPSVerifier", false);
    expect(result.reason).toBe("Order not found");
    expect(mocks.assertDriverAtDropoff).not.toHaveBeenCalled();
  });

  it("returns the database error when the order query fails", async () => {
    configureQueries({ data: null, error: { message: "orders unavailable" } });

    const result = await makeService()._verifyGPS(orderId, validCoordinates);

    expectProviderResult(result, "GPSVerifier", false);
    expect(result.reason).toBe("orders unavailable");
  });

  it("returns a provider failure when geofence verification rejects", async () => {
    configureQueries({ data: makeOrder(), error: null });
    mocks.assertDriverAtDropoff.mockRejectedValue(
      new Error("driver is outside geofence"),
    );

    const result = await makeService()._verifyGPS(orderId, validCoordinates);

    expectProviderResult(result, "GPSVerifier", false);
    expect(result.reason).toBe("driver is outside geofence");
  });

  it("returns a provider failure when the order query throws", async () => {
    mocks.supabase.from.mockImplementation(() => {
      throw new Error("database connection lost");
    });

    const result = await makeService()._verifyGPS(orderId, validCoordinates);

    expectProviderResult(result, "GPSVerifier", false);
    expect(result.reason).toBe("database connection lost");
  });
});

describe("OracleService._verifyOrderStatus", () => {
  it.each(["picked_up", "in_transit", "arriving"])(
    "confirms an order in the %s status",
    async (status) => {
      configureQueries({ data: makeOrder({ status }), error: null });

      const result = await makeService()._verifyOrderStatus(orderId);

      expectProviderResult(result, "StatusVerifier", true);
    },
  );

  it.each(["pending", "cancelled", "delivered", "payment_released", undefined])(
    "does not confirm an order in the %s status",
    async (status) => {
      configureQueries({ data: makeOrder({ status }), error: null });

      const result = await makeService()._verifyOrderStatus(orderId);

      expectProviderResult(result, "StatusVerifier", false);
    },
  );

  it("returns a not-found result when the order does not exist", async () => {
    configureQueries({ data: null, error: null });

    const result = await makeService()._verifyOrderStatus(orderId);

    expectProviderResult(result, "StatusVerifier", false);
    expect(result.reason).toBe("Order not found");
  });

  it("returns a database error when the status query fails", async () => {
    configureQueries({ data: null, error: { message: "status query failed" } });

    const result = await makeService()._verifyOrderStatus(orderId);

    expectProviderResult(result, "StatusVerifier", false);
    expect(result.error).toBe("status query failed");
    expect(mocks.logger.warn).toHaveBeenCalled();
  });

  it("converts unexpected status failures into a provider failure", async () => {
    mocks.supabase.from.mockImplementation(() => {
      throw new Error("status connection dropped");
    });

    const result = await makeService()._verifyOrderStatus(orderId);

    expectProviderResult(result, "StatusVerifier", false);
    expect(result.error).toBe("status connection dropped");
    expect(mocks.logger.error).toHaveBeenCalled();
  });
});

describe("OracleService.logOracleResult", () => {
  it("records the provider outcomes and consensus decision", async () => {
    const results = [
      { provider: "OTPVerifier", confirmed: true },
      { provider: "GPSVerifier", confirmed: false, reason: "outside geofence" },
      { provider: "StatusVerifier", confirmed: true, error: "stale read" },
    ];

    const result = await makeService().logOracleResult(orderId, results, true);

    expect(result).toMatchObject({
      orderId,
      consensusReached: true,
      results: [
        { provider: "OTPVerifier", confirmed: true },
        {
          provider: "GPSVerifier",
          confirmed: false,
          reason: "outside geofence",
        },
        { provider: "StatusVerifier", confirmed: true, error: "stale read" },
      ],
    });
    expect(result.timestamp).toEqual(expect.any(String));
    expect(mocks.logger.info).toHaveBeenCalledWith(
      "[OracleService] Verification result:",
      expect.stringContaining("consensusReached"),
    );
  });
});

describe("OracleService.getPriceFeed blockchain price feed", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns default fallback price for MATIC/USD when no overrides or live feed provided", async () => {
    const service = makeService();
    const feed = await service.getPriceFeed("MATIC/USD");

    expect(feed).toMatchObject({
      pair: "MATIC/USD",
      price: 0.75,
      source: "fallback",
      fallback: true,
    });
    expect(feed.timestamp).toEqual(expect.any(String));
  });

  it("returns default fallback prices for known tokens (ETH/USD, USDC/USD, FUEL/USD)", async () => {
    const service = makeService();
    const ethFeed = await service.getPriceFeed("ETH/USD");
    const usdcFeed = await service.getPriceFeed("USDC/USD");
    const fuelFeed = await service.getPriceFeed("FUEL/USD");

    expect(ethFeed.price).toBe(3000.0);
    expect(usdcFeed.price).toBe(1.0);
    expect(fuelFeed.price).toBe(3.90);
  });

  it("normalizes lowercase and whitespace in pair names", async () => {
    const service = makeService();
    const feed = await service.getPriceFeed("  matic/usd  ");

    expect(feed.pair).toBe("MATIC/USD");
    expect(feed.price).toBe(0.75);
  });

  it("uses custom fallbackPrice option when provided for an unknown pair", async () => {
    const service = makeService();
    const feed = await service.getPriceFeed("SOL/USD", { fallbackPrice: 150.25 });

    expect(feed).toMatchObject({
      pair: "SOL/USD",
      price: 150.25,
      source: "fallback",
      fallback: true,
    });
  });

  it("falls back to 1.0 for unknown pair when no custom fallbackPrice is provided", async () => {
    const service = makeService();
    const feed = await service.getPriceFeed("UNKNOWN/TOKEN");

    expect(feed.price).toBe(1.0);
    expect(feed.fallback).toBe(true);
  });

  it("respects environment variable price override (ORACLE_PRICE_...)", async () => {
    process.env.ORACLE_PRICE_MATIC_USD = "1.45";
    const service = makeService();
    const feed = await service.getPriceFeed("MATIC/USD");

    expect(feed).toMatchObject({
      pair: "MATIC/USD",
      price: 1.45,
      source: "env_override",
      fallback: false,
    });
  });

  it("ignores invalid or non-positive environment variable price override", async () => {
    process.env.ORACLE_PRICE_MATIC_USD = "-5";
    const service = makeService();
    const feed = await service.getPriceFeed("MATIC/USD");

    expect(feed.price).toBe(0.75);
    expect(feed.source).toBe("fallback");
  });

  it("fetches live price when CHAINLINK_ENABLED is true and fetchPriceFn is provided", async () => {
    process.env.CHAINLINK_ENABLED = "true";
    const service = makeService();
    const mockFetchFn = vi.fn().mockResolvedValue(0.82);

    const feed = await service.getPriceFeed("MATIC/USD", {
      fetchPriceFn: mockFetchFn,
    });

    expect(mockFetchFn).toHaveBeenCalledWith("MATIC/USD");
    expect(feed).toMatchObject({
      pair: "MATIC/USD",
      price: 0.82,
      source: "chainlink",
      fallback: false,
    });
  });

  it("falls back to default price and logs warning when live Chainlink fetch throws an error", async () => {
    process.env.CHAINLINK_ENABLED = "true";
    const service = makeService();
    const mockFetchFn = vi.fn().mockRejectedValue(new Error("RPC timeout"));

    const feed = await service.getPriceFeed("MATIC/USD", {
      fetchPriceFn: mockFetchFn,
    });

    expect(feed).toMatchObject({
      pair: "MATIC/USD",
      price: 0.75,
      source: "fallback",
      fallback: true,
    });
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ pair: "MATIC/USD" }),
      expect.stringContaining("Failed to fetch live price feed"),
    );
  });

  it("falls back when live Chainlink fetch returns non-finite or non-positive value", async () => {
    process.env.CHAINLINK_ENABLED = "true";
    const service = makeService();
    const mockFetchFn = vi.fn().mockResolvedValue(NaN);

    const feed = await service.getPriceFeed("MATIC/USD", {
      fetchPriceFn: mockFetchFn,
    });

    expect(feed.price).toBe(0.75);
    expect(feed.source).toBe("fallback");
  });
});

describe("OracleService.verifyCrossChain", () => {
  const validTxHash = "0x" + "a".repeat(64);
  const orderId = "order-crosschain-1";

  it("rejects invalid blockchain transaction hash format", async () => {
    const service = makeService();
    const result = await service.verifyCrossChain(orderId, "invalid-hash");

    expect(result).toMatchObject({
      verified: false,
      error: "Invalid blockchain transaction hash",
      code: "INVALID_BLOCKCHAIN_HASH",
    });
  });

  it("verifies successfully when blockchain hash matches and escrow is funded", async () => {
    configureQueries({
      data: {
        id: orderId,
        blockchain_tx_hash: validTxHash,
        escrow_status: "funded",
      },
      error: null,
    });

    const service = makeService();
    const result = await service.verifyCrossChain(orderId, validTxHash);

    expect(result.verified).toBe(true);
    expect(result.blockchainHash).toBe(validTxHash);
    expect(result.verificationUrl).toBe(`https://polygonscan.com/tx/${validTxHash}`);
  });

  it("verifies successfully when escrow is released", async () => {
    configureQueries({
      data: {
        id: orderId,
        blockchain_tx_hash: validTxHash,
        escrow_status: "released",
      },
      error: null,
    });

    const service = makeService();
    const result = await service.verifyCrossChain(orderId, validTxHash);

    expect(result.verified).toBe(true);
  });

  it("does not verify when hash does not match stored transaction hash", async () => {
    const differentTxHash = "0x" + "b".repeat(64);
    configureQueries({
      data: {
        id: orderId,
        blockchain_tx_hash: differentTxHash,
        escrow_status: "funded",
      },
      error: null,
    });

    const service = makeService();
    const result = await service.verifyCrossChain(orderId, validTxHash);

    expect(result.verified).toBe(false);
  });

  it("does not verify when order is not found in database", async () => {
    configureQueries({
      data: null,
      error: null,
    });

    const service = makeService();
    const result = await service.verifyCrossChain(orderId, validTxHash);

    expect(result.verified).toBe(false);
    expect(result.error).toBe("Order not found");
  });

  it("handles database query errors gracefully", async () => {
    configureQueries({
      data: null,
      error: { message: "DB timeout" },
    });

    const service = makeService();
    const result = await service.verifyCrossChain(orderId, validTxHash);

    expect(result.verified).toBe(false);
    expect(result.error).toBe("DB timeout");
    expect(mocks.logger.warn).toHaveBeenCalled();
  });
});
