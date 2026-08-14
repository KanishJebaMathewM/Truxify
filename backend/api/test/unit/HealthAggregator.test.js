import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/middleware/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { HealthAggregator } = await import("../../../src/core/health/HealthAggregator.js");
const { HealthStatus } = await import("../../../src/core/health/HealthCheck.js");

describe("HealthAggregator", () => {
  let aggregator;

  beforeEach(() => {
    aggregator = new HealthAggregator();
  });

  it("returns HEALTHY when all checks pass", async () => {
    aggregator.register("svc1", async () => ({ status: HealthStatus.HEALTHY }));
    aggregator.register("svc2", async () => ({ status: HealthStatus.HEALTHY }));
    const result = await aggregator.aggregate();
    expect(result.status).toBe(HealthStatus.HEALTHY);
    expect(result.summary.healthy).toBe(2);
  });

  it("returns DEGRADED when a non-critical check fails", async () => {
    aggregator.register("svc1", async () => ({ status: HealthStatus.HEALTHY }));
    aggregator.register("svc2", async () => ({ status: HealthStatus.UNHEALTHY }), { critical: false });
    const result = await aggregator.aggregate();
    expect(result.status).toBe(HealthStatus.DEGRADED);
  });

  it("returns UNHEALTHY when a critical check fails", async () => {
    aggregator.register("svc1", async () => ({ status: HealthStatus.HEALTHY }));
    // Critical services must be returned with critical flag set in result
    aggregator.register("svc2", async () => ({ status: HealthStatus.UNHEALTHY, critical: true }), { critical: true });
    const result = await aggregator.aggregate();
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
  });

  it("returns DEGRADED when a check returns degraded status", async () => {
    aggregator.register("svc1", async () => ({ status: HealthStatus.DEGRADED }));
    const result = await aggregator.aggregate();
    expect(result.status).toBe(HealthStatus.DEGRADED);
  });

  it("handles a check that throws by returning UNHEALTHY for that check", async () => {
    aggregator.register("svc1", async () => { throw new Error("network error"); });
    const result = await aggregator.aggregate();
    expect(result.services.svc1.status).toBe(HealthStatus.UNHEALTHY);
    expect(result.services.svc1.message).toBe("network error");
  });

  it("returns UNHEALTHY when critical check throws", async () => {
    aggregator.register("svc1", async () => ({ status: HealthStatus.HEALTHY }));
    aggregator.register("svc2", async () => { throw new Error("critical error"); }, { critical: true });
    const result = await aggregator.aggregate();
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
  });
});
