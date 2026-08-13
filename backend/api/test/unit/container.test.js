import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/config/db.js", () => ({
  supabase: {},
  supabaseAdmin: null,
  redisClient: null,
  mongoDb: null,
  firebaseAdmin: null,
}));

describe("container", () => {
  it("exports all expected service instances", async () => {
    const container = await import("../../../src/core/container.js");
    expect(container.orderRepository).toBeDefined();
    expect(container.orderTimelineService).toBeDefined();
    expect(container.orderValidationService).toBeDefined();
    expect(container.orderMilestoneService).toBeDefined();
    expect(container.orderNotificationService).toBeDefined();
    expect(container.bidAcceptanceService).toBeDefined();
    expect(container.trackingTokenService).toBeDefined();
    expect(container.deliveryVerificationService).toBeDefined();
    expect(container.orderLifecycleService).toBeDefined();
    expect(container.oracleService).toBeDefined();
    expect(container.verificationService).toBeDefined();
  });

  it("exports logger from middleware", async () => {
    const container = await import("../../../src/core/container.js");
    expect(container.logger).toBeDefined();
    expect(typeof container.logger.info).toBe("function");
    expect(typeof container.logger.warn).toBe("function");
    expect(typeof container.logger.error).toBe("function");
  });

  it("exports db clients", async () => {
    const container = await import("../../../src/core/container.js");
    expect(container.supabase).toBeDefined();
    expect(container.redisClient).toBeNull();
  });
});
