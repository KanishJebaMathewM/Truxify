import { describe, it, expect, vi, beforeEach } from "vitest";
import { HealthStatus } from "../../../src/core/health/HealthCheck.js";

vi.mock("../../../src/services/escrow.js", () => ({
  checkEscrowHealth: vi.fn(),
}));

const { checkEscrowHealth } = await import("../../../src/services/escrow.js");
const { default: escrowHealthFactory } = await import("../../../src/core/health/checks/escrowHealth.js");

describe("escrowHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns HEALTHY when escrow reports connected", async () => {
    checkEscrowHealth.mockResolvedValue({ status: "connected", chainId: 137 });
    const checkFn = escrowHealthFactory();
    const result = await checkFn();
    expect(result.status).toBe(HealthStatus.HEALTHY);
    expect(result.metadata.chainId).toBe(137);
  });

  it("returns DEGRADED when escrow is not configured", async () => {
    checkEscrowHealth.mockResolvedValue({ status: "not_configured" });
    const checkFn = escrowHealthFactory();
    const result = await checkFn();
    expect(result.status).toBe(HealthStatus.DEGRADED);
    expect(result.message).toBe("not_configured");
  });

  it("returns UNHEALTHY when escrow reports an error", async () => {
    checkEscrowHealth.mockResolvedValue({ status: "error", error: "network timeout" });
    const checkFn = escrowHealthFactory();
    const result = await checkFn();
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
    expect(result.message).toBe("network timeout");
  });
});
