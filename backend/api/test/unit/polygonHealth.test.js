import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import polygonHealth from "../../src/core/health/checks/polygonHealth.js";

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
    const result = await polygonHealth();
    expect(result.status).toBe("unhealthy");
    expect(result.message).toBe("not_configured");
  });

  it("returns HEALTHY when RPC responds with block number", async () => {
    process.env.POLYGON_RPC_URL = "https://rpc.polygon.io";
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1, result: "0x1234" }),
    });
    const result = await polygonHealth();
    expect(result.status).toBe("healthy");
    expect(result.metadata.blockNumber).toBe("0x1234");
  });

  it("returns UNHEALTHY when RPC returns HTTP error", async () => {
    process.env.POLYGON_RPC_URL = "https://rpc.polygon.io";
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    const result = await polygonHealth();
    expect(result.status).toBe("unhealthy");
  });
});
