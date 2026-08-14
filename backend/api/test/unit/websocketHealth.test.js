import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../src/core/health/HealthCheck.js", () => ({
  HealthStatus: { HEALTHY: "healthy", DEGRADED: "degraded", UNHEALTHY: "unhealthy" },
  executeCheck: (name, checkFn) => checkFn(),
}));

describe("websocketHealth", () => {
  let originalWsState;

  beforeEach(() => {
    originalWsState = globalThis.__truxify_wsState;
  });

  afterEach(() => {
    globalThis.__truxify_wsState = originalWsState;
  });

  it("returns UNHEALTHY when no wsState is registered", async () => {
    globalThis.__truxify_wsState = undefined;
    const { default: websocketHealth } = await import("../../../src/core/health/checks/websocketHealth.js");
    const result = await websocketHealth()();
    expect(result.status).toBe("unhealthy");
    expect(result.message).toBe("no_websocket_server");
  });

  it("returns HEALTHY when WebSocket server is running", async () => {
    globalThis.__truxify_wsState = {
      hasWebSocketServer: true,
      hasWsHeartbeatInterval: true,
      isSchedulerActive: true,
      pubSub: { enabled: true, ready: true },
    };
    const { default: websocketHealth } = await import("../../../src/core/health/checks/websocketHealth.js");
    const result = await websocketHealth()();
    expect(result.status).toBe("healthy");
    expect(result.message).toBe("active");
    expect(result.metadata.hasServer).toBe(true);
  });

  it("returns UNHEALTHY when server is not running", async () => {
    globalThis.__truxify_wsState = {
      hasWebSocketServer: false,
      hasWsHeartbeatInterval: false,
      isSchedulerActive: false,
      pubSub: null,
    };
    const { default: websocketHealth } = await import("../../../src/core/health/checks/websocketHealth.js");
    const result = await websocketHealth()();
    expect(result.status).toBe("unhealthy");
    expect(result.message).toBe("server_not_running");
  });
});
