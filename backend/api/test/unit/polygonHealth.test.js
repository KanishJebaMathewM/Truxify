import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../src/core/health/HealthCheck.js", () => ({
  HealthStatus: { HEALTHY: "healthy", DEGRADED: "degraded", UNHEALTHY: "unhealthy" },
  executeCheck: (name, checkFn) => checkFn(),
}));

describe("polygonHealth", () => {
  let originalEnv;
  let fetchMock;

  beforeEach(() => {
    originalEnv = { ...process.env };
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns UNHEALTHY when POLYGON_RPC_URL is not set", async () => {
    delete process.env.POLYGON_RPC_URL;
    const { default: polygonHealth } = await import("../../../src/core/health/checks/polygonHealth.js");
    const result = await polygonHealth()();
    expect(result.status).toBe("unhealthy");
    expect(result.message).toBe("not_configured");
  });

  it("returns HEALTHY when RPC responds with block number", async () => {
    process.env.POLYGON_RPC_URL = "https://rpc.polygon.io";
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1, result: "0x1234" }),
    });
    const { default: polygonHealth } = await import("../../../src/core/health/checks/polygonHealth.js");
    const result = await polygonHealth()();
    expect(result.status).toBe("healthy");
    expect(result.metadata.blockNumber).toBe("0x1234");
  });

  it("returns UNHEALTHY when RPC returns HTTP error", async () => {
    process.env.POLYGON_RPC_URL = "https://rpc.polygon.io";
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    const { default: polygonHealth } = await import("../../../src/core/health/checks/polygonHealth.js");
    const result = await polygonHealth()();
    expect(result.status).toBe("unhealthy");
  });
});
