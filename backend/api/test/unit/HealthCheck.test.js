import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/middleware/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { withTimeout, executeCheck, HealthStatus } = await import("../../../src/core/health/HealthCheck.js");

describe("withTimeout", () => {
  it("resolves when promise resolves within timeout", async () => {
    const promise = new Promise((r) => setTimeout(() => r("ok"), 10));
    const result = await withTimeout(promise, 500);
    expect(result).toBe("ok");
  });

  it("rejects when promise exceeds timeout", async () => {
    const promise = new Promise((r) => setTimeout(() => r("ok"), 500));
    await expect(withTimeout(promise, 50)).rejects.toThrow(/timeout/);
  });
});

describe("executeCheck", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("returns HEALTHY when check resolves with healthy status", async () => {
    const check = vi.fn().mockResolvedValue({ status: HealthStatus.HEALTHY });
    const p = executeCheck("test-svc", check, { timeoutMs: 1000 });
    const result = await p;
    expect(result.status).toBe(HealthStatus.HEALTHY);
    expect(result.name).toBe("test-svc");
  });

  it("returns UNHEALTHY when check throws", async () => {
    const check = vi.fn().mockRejectedValue(new Error("check failed"));
    const p = executeCheck("test-svc", check, { timeoutMs: 1000 });
    const result = await p;
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
    expect(result.message).toBe("check failed");
  });
});
