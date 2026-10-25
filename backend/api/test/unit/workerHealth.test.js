import { describe, it, expect, beforeEach, afterEach } from "vitest";

import workerHealth from "../../src/core/health/checks/workerHealth.js";

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
    const result = await workerHealth();
    expect(result.status).toBe("unhealthy");
    expect(result.message).toBe("no_registered_workers");
  });

  it("returns HEALTHY when all workers are running", async () => {
    globalThis.__truxify_workers = { outboxRelay: true, dlqWorker: true };
    const result = await workerHealth();
    expect(result.status).toBe("healthy");
    expect(result.metadata.workerCount).toBe(2);
  });

  it("returns DEGRADED when some workers are not running", async () => {
    globalThis.__truxify_workers = { outboxRelay: true, dlqWorker: false };
    const result = await workerHealth();
    expect(result.status).toBe("degraded");
    expect(result.metadata.workerCount).toBe(2);
  });
});
