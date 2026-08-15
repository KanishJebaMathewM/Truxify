import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/config/db.js", () => ({
  mongoDb: null,
}));

vi.mock("../../../src/core/health/HealthCheck.js", () => ({
  HealthStatus: { HEALTHY: "healthy", DEGRADED: "degraded", UNHEALTHY: "unhealthy" },
  executeCheck: (name, checkFn) => checkFn(),
}));

describe("mongodbHealth", () => {
  it("returns UNHEALTHY when mongoDb is not configured", async () => {
    const { default: mongodbHealth } = await import("../../../src/core/health/checks/mongodbHealth.js");
    const result = await mongodbHealth()();
    expect(result.status).toBe("unhealthy");
    expect(result.message).toBe("not_configured");
  });
});
