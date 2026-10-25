import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import graphqlHealth from "../../src/core/health/checks/graphqlHealth.js";

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
    const result = await graphqlHealth();
    expect(result.status).toBe("healthy");
    expect(result.metadata.port).toBe("4000");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("returns DEGRADED when GraphQL server returns non-200", async () => {
    process.env.GRAPHQL_PORT = "4000";
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const result = await graphqlHealth();
    expect(result.status).toBe("degraded");
  });

  it("returns DEGRADED when GraphQL server is unreachable", async () => {
    process.env.GRAPHQL_PORT = "4000";
    fetchMock.mockRejectedValue(new Error("fetch failed"));
    const result = await graphqlHealth();
    expect(result.status).toBe("degraded");
  });

  it("aborts the request and reports unhealthy when the probe deadline expires", async () => {
    process.env.GRAPHQL_PORT = "4000";
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const err = new Error("probe aborted");
        err.name = "AbortError";
        reject(err);
      });
    }));

    const result = await graphqlHealth({ timeoutMs: 25 });
    const signal = fetchMock.mock.calls[0][1].signal;

    expect(result.status).toBe("unhealthy");
    expect(signal.aborted).toBe(true);
  });
});
