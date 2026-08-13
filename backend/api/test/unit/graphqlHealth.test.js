import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../src/core/health/HealthCheck.js", () => ({
  HealthStatus: { HEALTHY: "healthy", DEGRADED: "degraded", UNHEALTHY: "unhealthy" },
  executeCheck: (name, checkFn) => checkFn(),
  withTimeout: (p) => p,
}));

vi.mock("../../../src/middleware/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("graphqlHealth", () => {
  let fetchMock;
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns HEALTHY when GraphQL server responds with 200", async () => {
    process.env.GRAPHQL_PORT = "4000";
    fetchMock.mockResolvedValue({ ok: true });
    const { default: graphqlHealth } = await import("../../../src/core/health/checks/graphqlHealth.js");
    const result = await graphqlHealth()();
    expect(result.status).toBe("healthy");
    expect(result.metadata.port).toBe("4000");
  });

  it("returns DEGRADED when GraphQL server returns non-200", async () => {
    process.env.GRAPHQL_PORT = "4000";
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const { default: graphqlHealth } = await import("../../../src/core/health/checks/graphqlHealth.js");
    const result = await graphqlHealth()();
    expect(result.status).toBe("degraded");
  });

  it("returns DEGRADED when GraphQL server is unreachable", async () => {
    process.env.GRAPHQL_PORT = "4000";
    fetchMock.mockRejectedValue(new Error("fetch failed"));
    const { default: graphqlHealth } = await import("../../../src/core/health/checks/graphqlHealth.js");
    const result = await graphqlHealth()();
    expect(result.status).toBe("degraded");
  });
});
