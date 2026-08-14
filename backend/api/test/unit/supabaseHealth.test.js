import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/config/db.js", () => ({
  supabase: null,
  supabaseAdmin: null,
}));

vi.mock("../../../src/core/health/HealthCheck.js", () => ({
  HealthStatus: { HEALTHY: "healthy", DEGRADED: "degraded", UNHEALTHY: "unhealthy" },
  executeCheck: (name, checkFn) => checkFn(),
}));

describe("supabaseHealth", () => {
  it("returns UNHEALTHY when no client is configured", async () => {
    const { default: supabaseHealth } = await import("../../../src/core/health/checks/supabaseHealth.js");
    const result = await supabaseHealth()();
    expect(result.status).toBe("unhealthy");
    expect(result.message).toBe("not_configured");
  });
});
