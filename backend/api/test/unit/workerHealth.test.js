import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../src/core/health/HealthCheck.js", () => ({
  HealthStatus: { HEALTHY: "healthy", DEGRADED: "degraded", UNHEALTHY: "unhealthy" },
  executeCheck: (name, checkFn) => checkFn(),
}));

describe("workerHealth", () => {
  let originalWorkers;

  beforeEach(() => {
    originalWorkers = globalThis.__truxify_workers;
  });

  afterEach(() => {
    globalThis.__truxify_workers = originalWorkers;
  });

  it("returns UNHEALTHY when no workers are registered", async () => {
    globalThis.__truxify_workers = undefined;
    const { default: workerHealth } = await import("../../../src/core/health/checks/workerHealth.js");
    const result = await workerHealth()();
    expect(result.status).toBe("unhealthy");
    expect(result.message).toBe("no_registered_workers");
  });

  it("returns HEALTHY when all workers are running", async () => {
    globalThis.__truxify_workers = { outboxRelay: true, dlqWorker: true };
    const { default: workerHealth } = await import("../../../src/core/health/checks/workerHealth.js");
    const result = await workerHealth()();
    expect(result.status).toBe("healthy");
    expect(result.metadata.workerCount).toBe(2);
  });

  it("returns DEGRADED when some workers are not running", async () => {
    globalThis.__truxify_workers = { outboxRelay: true, dlqWorker: false };
    const { default: workerHealth } = await import("../../../src/core/health/checks/workerHealth.js");
    const result = await workerHealth()();
    expect(result.status).toBe("degraded");
    expect(result.metadata.workerCount).toBe(2);
  });
});
