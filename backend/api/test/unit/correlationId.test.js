import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
}));

vi.mock("../../src/middleware/logger.js", () => ({
  default: mockLogger,
}));

import {
  correlationIdMiddleware,
  getCorrelationStore,
  runWithCorrelationId,
} from "../../src/middleware/correlationId.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createResponse() {
  return { setHeader: vi.fn() };
}

function runMiddleware(headers = {}, response = createResponse()) {
  const request = { headers };
  const next = vi.fn(() => getCorrelationStore());

  correlationIdMiddleware(request, response, next);

  return { request, response, next };
}

describe("correlationIdMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("propagates a valid client correlation ID to the request and response", () => {
    const { request, response, next } = runMiddleware({
      "x-correlation-id": "client-request-42",
    });

    expect(request.correlationId).toBe("client-request-42");
    expect(response.setHeader).toHaveBeenCalledWith(
      "X-Correlation-ID",
      "client-request-42",
    );
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveReturnedWith({ correlationId: "client-request-42" });
  });

  it("accepts supported header casing, surrounding whitespace, and array headers", () => {
    const { request, response } = runMiddleware({
      "X-Correlation-ID": ["  alternate-header-id  ", "ignored-id"],
    });

    expect(request.correlationId).toBe("alternate-header-id");
    expect(response.setHeader).toHaveBeenCalledWith(
      "X-Correlation-ID",
      "alternate-header-id",
    );
  });

  it("generates a UUID when the client correlation ID has an invalid format", () => {
    const { request, response } = runMiddleware({
      "x-correlation-id": "contains spaces and is invalid",
    });

    expect(request.correlationId).toMatch(uuidPattern);
    expect(response.setHeader).toHaveBeenCalledWith(
      "X-Correlation-ID",
      request.correlationId,
    );
  });

  it("generates a UUID when no correlation ID is provided", () => {
    const { request, response } = runMiddleware();

    expect(request.correlationId).toMatch(uuidPattern);
    expect(response.setHeader).toHaveBeenCalledWith(
      "X-Correlation-ID",
      request.correlationId,
    );
  });

  it("supports responses without a setHeader function", () => {
    const { request, next } = runMiddleware({}, {});

    expect(request.correlationId).toMatch(uuidPattern);
    expect(next).toHaveBeenCalledOnce();
  });

  it("emits the correlation ID event with request metadata when propagated from client", () => {
    const { request } = runMiddleware({ "x-correlation-id": "trace-abc" });
    request.requestId = "request-123";

    mockLogger.debug.mockClear();
    correlationIdMiddleware(request, createResponse(), vi.fn());

    expect(mockLogger.debug).toHaveBeenCalledWith(
      {
        event: "CORRELATION_ID_SET",
        correlationId: "trace-abc",
        requestId: "request-123",
      },
      "Correlation ID trace-abc propagated from client",
    );
  });

  it("emits the correlation ID event with request metadata when generated", () => {
    const request = { headers: {}, id: "req-999" };
    mockLogger.debug.mockClear();
    correlationIdMiddleware(request, createResponse(), vi.fn());

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "CORRELATION_ID_SET",
        correlationId: request.correlationId,
        requestId: "req-999",
      }),
      expect.stringContaining("generated"),
    );
  });
});

describe("runWithCorrelationId and getCorrelationStore", () => {
  describe("getCorrelationStore", () => {
    it("returns an empty object when called outside any correlation context", () => {
      const store = getCorrelationStore();
      expect(store).toEqual({});
      expect(store.correlationId).toBeUndefined();
    });

    it("returns the current store object containing correlationId within runWithCorrelationId", () => {
      runWithCorrelationId("test-corr-id-123", () => {
        const store = getCorrelationStore();
        expect(store).toEqual({ correlationId: "test-corr-id-123" });
        expect(store.correlationId).toBe("test-corr-id-123");
      });
    });
  });

  describe("runWithCorrelationId", () => {
    it("propagates correlation ID synchronously to child function executions", () => {
      const result = runWithCorrelationId("sync-id-1", () => {
        expect(getCorrelationStore().correlationId).toBe("sync-id-1");
        return "sync-result";
      });
      expect(result).toBe("sync-result");
      expect(getCorrelationStore().correlationId).toBeUndefined();
    });

    it("propagates correlation ID to async children across promises and awaits", async () => {
      await runWithCorrelationId("async-id-1", async () => {
        expect(getCorrelationStore().correlationId).toBe("async-id-1");

        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(getCorrelationStore().correlationId).toBe("async-id-1");

        const nestedAsync = async () => {
          await new Promise((resolve) => setImmediate(resolve));
          return getCorrelationStore().correlationId;
        };

        const resolvedId = await nestedAsync();
        expect(resolvedId).toBe("async-id-1");
      });

      expect(getCorrelationStore().correlationId).toBeUndefined();
    });

    it("propagates correlation ID concurrently across Promise.all tasks", async () => {
      const task1 = runWithCorrelationId("task-1-id", async () => {
        await new Promise((r) => setTimeout(r, 15));
        return getCorrelationStore().correlationId;
      });

      const task2 = runWithCorrelationId("task-2-id", async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getCorrelationStore().correlationId;
      });

      const [res1, res2] = await Promise.all([task1, task2]);
      expect(res1).toBe("task-1-id");
      expect(res2).toBe("task-2-id");
    });

    it("maintains separate contexts for nested calls and restores outer context on exit", () => {
      let outerBefore = null;
      let innerValue = null;
      let outerAfter = null;

      runWithCorrelationId("outer-scope-id", () => {
        outerBefore = getCorrelationStore().correlationId;

        runWithCorrelationId("inner-scope-id", () => {
          innerValue = getCorrelationStore().correlationId;
        });

        outerAfter = getCorrelationStore().correlationId;
      });

      expect(outerBefore).toBe("outer-scope-id");
      expect(innerValue).toBe("inner-scope-id");
      expect(outerAfter).toBe("outer-scope-id");
      expect(getCorrelationStore().correlationId).toBeUndefined();
    });

    it("handles undefined or null correlation ID without throwing", () => {
      runWithCorrelationId(undefined, () => {
        const store = getCorrelationStore();
        expect(store).toEqual({ correlationId: undefined });
      });

      runWithCorrelationId(null, () => {
        const store = getCorrelationStore();
        expect(store).toEqual({ correlationId: null });
      });
    });

    it("re-throws errors thrown inside fn while still cleaning up the context", () => {
      expect(() => {
        runWithCorrelationId("error-id", () => {
          expect(getCorrelationStore().correlationId).toBe("error-id");
          throw new Error("Custom execution failure");
        });
      }).toThrow("Custom execution failure");

      expect(getCorrelationStore().correlationId).toBeUndefined();
    });
  });
});